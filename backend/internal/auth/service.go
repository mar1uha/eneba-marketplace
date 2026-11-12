package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// SessionTTL is a sliding window: each active day pushes expiry forward.
	SessionTTL = 14 * 24 * time.Hour
	// Sessions are touched at most this often, so reads do not turn into a write per request.
	sessionTouchInterval = time.Hour
	resetTokenTTL        = 30 * time.Minute
	maxUserAgentLen      = 300
)

var (
	ErrEmailTaken            = errors.New("email already registered")
	ErrInvalidCredentials    = errors.New("invalid credentials")
	ErrNoSession             = errors.New("no valid session")
	ErrInvalidResetToken     = errors.New("invalid or expired reset token")
	ErrSessionNotFound       = errors.New("session not found")
	ErrGoogleEmailUnverified = errors.New("google email not verified")
)

type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	DisplayName  string    `json:"display_name"`
	HasPassword  bool      `json:"has_password"`
	GoogleLinked bool      `json:"google_linked"`
	CreatedAt    time.Time `json:"created_at"`
}

type Session struct {
	ID         int64     `json:"id"`
	UserAgent  string    `json:"user_agent"`
	IP         string    `json:"ip"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
	ExpiresAt  time.Time `json:"-"`
}

// ClientInfo describes the device a session is created from, shown on the security page.
type ClientInfo struct {
	UserAgent string
	IP        string
}

type GoogleProfile struct {
	Sub           string
	Email         string
	EmailVerified bool
	Name          string
}

type Mailer interface {
	SendPasswordReset(ctx context.Context, to, link string) error
}

// LogMailer simulates email delivery by writing the message to the server log.
type LogMailer struct{}

func (LogMailer) SendPasswordReset(_ context.Context, to, link string) error {
	slog.Info("simulated email: password reset", "to", to, "link", link)
	return nil
}

type Service struct {
	db           *pgxpool.Pool
	mailer       Mailer
	resetPageURL string
	now          func() time.Time
}

func NewService(db *pgxpool.Pool, mailer Mailer, appBaseURL string) *Service {
	return &Service{db: db, mailer: mailer, resetPageURL: appBaseURL + "/reset-password", now: time.Now}
}

const userColumns = `u.id, u.email, u.display_name, u.password_hash IS NOT NULL, u.google_sub IS NOT NULL, u.created_at`

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.HasPassword, &u.GoogleLinked, &u.CreatedAt)
	return u, err
}

func (s *Service) userByID(ctx context.Context, q querier, id int64) (User, error) {
	return scanUser(q.QueryRow(ctx, `SELECT `+userColumns+` FROM users u WHERE u.id = $1`, id))
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func (s *Service) Register(ctx context.Context, email, password string, client ClientInfo) (User, string, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, "", err
	}
	if err := validatePassword("password", password); err != nil {
		return User{}, "", err
	}

	var id int64
	err = s.db.QueryRow(ctx,
		`INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
		email, displayNameFromEmail(email), HashPassword(password)).Scan(&id)
	if isUniqueViolation(err) {
		return User{}, "", ErrEmailTaken
	}
	if err != nil {
		return User{}, "", fmt.Errorf("insert user: %w", err)
	}
	return s.startSession(ctx, s.db, id, client)
}

func (s *Service) Login(ctx context.Context, email, password string, client ClientInfo) (User, string, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, "", err
	}
	var id int64
	var hash *string
	err = s.db.QueryRow(ctx, `SELECT id, password_hash FROM users WHERE email = $1`, email).Scan(&id, &hash)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && hash == nil) {
		_, _ = VerifyPassword(password, dummyHash())
		return User{}, "", ErrInvalidCredentials
	}
	if err != nil {
		return User{}, "", fmt.Errorf("find user: %w", err)
	}
	ok, err := VerifyPassword(password, *hash)
	if err != nil {
		return User{}, "", err
	}
	if !ok {
		return User{}, "", ErrInvalidCredentials
	}
	if _, err := s.db.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND expires_at <= $2`, id, s.now()); err != nil {
		return User{}, "", fmt.Errorf("prune sessions: %w", err)
	}
	return s.startSession(ctx, s.db, id, client)
}

func (s *Service) startSession(ctx context.Context, q querier, userID int64, client ClientInfo) (User, string, error) {
	token := newToken()
	now := s.now()
	ua := client.UserAgent
	if len(ua) > maxUserAgentLen {
		ua = ua[:maxUserAgentLen]
	}
	_, err := q.Exec(ctx,
		`INSERT INTO sessions (user_id, token_hash, user_agent, ip, created_at, last_seen_at, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $5, $6)`,
		userID, hashToken(token), ua, client.IP, now, now.Add(SessionTTL))
	if err != nil {
		return User{}, "", fmt.Errorf("insert session: %w", err)
	}
	user, err := s.userByID(ctx, q, userID)
	return user, token, err
}

// Authenticate resolves a session cookie. refreshed reports that expiry moved forward,
// so the caller should re-send the cookie with a fresh Max-Age.
func (s *Service) Authenticate(ctx context.Context, token string) (user User, session Session, refreshed bool, err error) {
	now := s.now()
	row := s.db.QueryRow(ctx,
		`SELECT `+userColumns+`, s.id, s.user_agent, s.ip, s.created_at, s.last_seen_at, s.expires_at
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.token_hash = $1 AND s.expires_at > $2`, hashToken(token), now)
	err = row.Scan(&user.ID, &user.Email, &user.DisplayName, &user.HasPassword, &user.GoogleLinked, &user.CreatedAt,
		&session.ID, &session.UserAgent, &session.IP, &session.CreatedAt, &session.LastSeenAt, &session.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, Session{}, false, ErrNoSession
	}
	if err != nil {
		return User{}, Session{}, false, fmt.Errorf("load session: %w", err)
	}

	if now.Sub(session.LastSeenAt) >= sessionTouchInterval {
		session.LastSeenAt, session.ExpiresAt = now, now.Add(SessionTTL)
		_, err = s.db.Exec(ctx, `UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE id = $1`,
			session.ID, session.LastSeenAt, session.ExpiresAt)
		if err != nil {
			return User{}, Session{}, false, fmt.Errorf("touch session: %w", err)
		}
		refreshed = true
	}
	return user, session, refreshed, nil
}

func (s *Service) Logout(ctx context.Context, sessionID int64) error {
	_, err := s.db.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, sessionID)
	return err
}

func (s *Service) ListSessions(ctx context.Context, userID int64) ([]Session, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, user_agent, ip, created_at, last_seen_at, expires_at FROM sessions
		 WHERE user_id = $1 AND expires_at > $2 ORDER BY last_seen_at DESC`, userID, s.now())
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Session])
}

func (s *Service) RevokeSession(ctx context.Context, userID, sessionID int64) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM sessions WHERE id = $1 AND user_id = $2`, sessionID, userID)
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrSessionNotFound
	}
	return nil
}

func (s *Service) RevokeOtherSessions(ctx context.Context, userID, keepSessionID int64) (int64, error) {
	tag, err := s.db.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, userID, keepSessionID)
	if err != nil {
		return 0, fmt.Errorf("revoke sessions: %w", err)
	}
	return tag.RowsAffected(), nil
}

// ChangePassword sets a new password and signs out every other session.
// Accounts created with Google have no password yet, so they can set one without a current password.
func (s *Service) ChangePassword(ctx context.Context, userID, keepSessionID int64, current, next string) error {
	if err := validatePassword("new_password", next); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var hash *string
	if err := tx.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&hash); err != nil {
		return fmt.Errorf("load user: %w", err)
	}
	if hash != nil {
		ok, err := VerifyPassword(current, *hash)
		if err != nil {
			return err
		}
		if !ok {
			return &ValidationError{Field: "current_password", Message: "Current password is incorrect."}
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1`, userID, HashPassword(next), s.now()); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, userID, keepSessionID); err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}
	return tx.Commit(ctx)
}

// RequestPasswordReset always succeeds for a well-formed email, so the response never reveals whether an account exists.
func (s *Service) RequestPasswordReset(ctx context.Context, email string) error {
	email, err := NormalizeEmail(email)
	if err != nil {
		return err
	}
	var userID int64
	err = s.db.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find user: %w", err)
	}

	token := newToken()
	now := s.now()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM password_reset_tokens WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("clear reset tokens: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)`,
		hashToken(token), userID, now.Add(resetTokenTTL), now); err != nil {
		return fmt.Errorf("insert reset token: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return s.mailer.SendPasswordReset(ctx, email, s.resetPageURL+"?token="+token)
}

// ResetPassword consumes a reset token, sets the password, signs out every device, and starts a new session.
func (s *Service) ResetPassword(ctx context.Context, token, password string, client ClientInfo) (User, string, error) {
	if err := validatePassword("password", password); err != nil {
		return User{}, "", err
	}
	now := s.now()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return User{}, "", err
	}
	defer tx.Rollback(ctx)

	var userID int64
	err = tx.QueryRow(ctx,
		`UPDATE password_reset_tokens SET used_at = $2
		 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
		 RETURNING user_id`, hashToken(token), now).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, "", ErrInvalidResetToken
	}
	if err != nil {
		return User{}, "", fmt.Errorf("consume reset token: %w", err)
	}
	// Receiving the reset email proves ownership of the address.
	if _, err := tx.Exec(ctx,
		`UPDATE users SET password_hash = $2, email_verified_at = coalesce(email_verified_at, $3), updated_at = $3 WHERE id = $1`,
		userID, HashPassword(password), now); err != nil {
		return User{}, "", fmt.Errorf("update password: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID); err != nil {
		return User{}, "", fmt.Errorf("revoke sessions: %w", err)
	}
	user, sessionToken, err := s.startSession(ctx, tx, userID, client)
	if err != nil {
		return User{}, "", err
	}
	return user, sessionToken, tx.Commit(ctx)
}

// SignInWithGoogle finds the account by Google ID, links an existing account with the same
// verified email, or creates a new account.
func (s *Service) SignInWithGoogle(ctx context.Context, p GoogleProfile, client ClientInfo) (User, string, error) {
	if p.Sub == "" {
		return User{}, "", errors.New("google profile without subject")
	}
	if !p.EmailVerified {
		return User{}, "", ErrGoogleEmailUnverified
	}
	email, err := NormalizeEmail(p.Email)
	if err != nil {
		return User{}, "", err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return User{}, "", err
	}
	defer tx.Rollback(ctx)

	now := s.now()
	var userID int64
	err = tx.QueryRow(ctx, `SELECT id FROM users WHERE google_sub = $1`, p.Sub).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Linking by email. Sign-up does not verify emails, so an unverified password account may
		// have been pre-registered by someone else: drop its password and sessions so only the
		// Google-proven owner keeps access.
		var wasUnverified bool
		err = tx.QueryRow(ctx,
			`WITH prev AS (
			     SELECT id, email_verified_at IS NULL AS unverified FROM users
			     WHERE email = $1 AND google_sub IS NULL FOR UPDATE
			 )
			 UPDATE users u SET
			     google_sub = $2,
			     password_hash = CASE WHEN prev.unverified THEN NULL ELSE u.password_hash END,
			     email_verified_at = coalesce(u.email_verified_at, $3),
			     updated_at = $3
			 FROM prev WHERE u.id = prev.id
			 RETURNING u.id, prev.unverified`,
			email, p.Sub, now).Scan(&userID, &wasUnverified)
		if err == nil && wasUnverified {
			_, err = tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID)
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		name := strings.TrimSpace(p.Name)
		if name == "" {
			name = displayNameFromEmail(email)
		}
		err = tx.QueryRow(ctx,
			`INSERT INTO users (email, display_name, google_sub, email_verified_at) VALUES ($1, $2, $3, $4) RETURNING id`,
			email, truncate(name, 100), p.Sub, now).Scan(&userID)
	}
	if isUniqueViolation(err) {
		// The email belongs to an account already linked to a different Google ID.
		return User{}, "", ErrEmailTaken
	}
	if err != nil {
		return User{}, "", fmt.Errorf("resolve google user: %w", err)
	}

	user, token, err := s.startSession(ctx, tx, userID, client)
	if err != nil {
		return User{}, "", err
	}
	return user, token, tx.Commit(ctx)
}

func displayNameFromEmail(email string) string {
	return truncate(email[:strings.Index(email, "@")], 100)
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
