package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"eneba-marketplace/backend/internal/auth"
)

const (
	oauthCookieName = "eneba_oauth"
	oauthCookiePath = "/api/auth/google"
	defaultNextPath = "/"
)

type authContextKey struct{}

type authState struct {
	User    auth.User
	Session auth.Session
}

func currentAuth(r *http.Request) *authState {
	s, _ := r.Context().Value(authContextKey{}).(*authState)
	return s
}

// The __Host- prefix makes browsers refuse the cookie unless it is Secure, host-only, and Path=/.
// Plain HTTP local development cannot use Secure cookies in every browser, so it falls back.
func (a *API) sessionCookieName() string {
	if a.CookieSecure {
		return "__Host-eneba_session"
	}
	return "eneba_session"
}

func (a *API) setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     a.sessionCookieName(),
		Value:    token,
		Path:     "/",
		MaxAge:   int(auth.SessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   a.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (a *API) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: a.sessionCookieName(), Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: a.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

// loadSession attaches the signed-in user, if any, to the request context.
func (a *API) loadSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(a.sessionCookieName())
		if err != nil || c.Value == "" {
			next.ServeHTTP(w, r)
			return
		}
		user, session, refreshed, err := a.Auth.Authenticate(r.Context(), c.Value)
		switch {
		case errors.Is(err, auth.ErrNoSession):
			a.clearSessionCookie(w)
		case err != nil:
			writeServerError(w, err, "authenticate session", "internal error")
			return
		default:
			if refreshed {
				a.setSessionCookie(w, c.Value)
			}
			r = r.WithContext(context.WithValue(r.Context(), authContextKey{}, &authState{User: user, Session: session}))
		}
		next.ServeHTTP(w, r)
	})
}

func requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if currentAuth(r) == nil {
			writeError(w, http.StatusUnauthorized, "Sign in required.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// rejectCrossSite blocks state-changing requests sent by other websites (CSRF).
// SameSite=Lax cookies already stop most of them; checking Origin covers the rest.
// Requests without an Origin header come from non-browser clients, which cannot ride a user's cookies.
func rejectCrossSite(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[strings.TrimRight(o, "/")] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
			default:
				if origin := r.Header.Get("Origin"); origin != "" && !allowed[origin] {
					writeError(w, http.StatusForbidden, "cross-site request blocked")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func clientInfo(r *http.Request) auth.ClientInfo {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	return auth.ClientInfo{UserAgent: r.UserAgent(), IP: ip}
}

func (a *API) writeAuthError(w http.ResponseWriter, err error) {
	var ve *auth.ValidationError
	switch {
	case errors.As(err, &ve):
		writeFieldError(w, http.StatusBadRequest, ve.Field, ve.Message)
	case errors.Is(err, auth.ErrEmailTaken):
		writeFieldError(w, http.StatusConflict, "email", "An account with this email already exists.")
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, http.StatusUnauthorized, "Incorrect email or password.")
	case errors.Is(err, auth.ErrInvalidResetToken):
		writeError(w, http.StatusBadRequest, "This reset link is invalid or has expired.")
	case errors.Is(err, auth.ErrSessionNotFound):
		writeError(w, http.StatusNotFound, "Session not found.")
	default:
		writeServerError(w, err, "auth request failed", "internal error")
	}
}

type userResponse struct {
	User *auth.User `json:"user"`
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (a *API) register(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if !decodeJSON(w, r, &in) {
		return
	}
	user, token, err := a.Auth.Register(r.Context(), in.Email, in.Password, clientInfo(r))
	if err != nil {
		a.writeAuthError(w, err)
		return
	}
	a.setSessionCookie(w, token)
	writeJSON(w, http.StatusCreated, userResponse{User: &user})
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if !decodeJSON(w, r, &in) {
		return
	}
	user, token, err := a.Auth.Login(r.Context(), in.Email, in.Password, clientInfo(r))
	if err != nil {
		a.writeAuthError(w, err)
		return
	}
	a.setSessionCookie(w, token)
	writeJSON(w, http.StatusOK, userResponse{User: &user})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	if s := currentAuth(r); s != nil {
		if err := a.Auth.Logout(r.Context(), s.Session.ID); err != nil {
			a.writeAuthError(w, err)
			return
		}
	}
	a.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// me answers 200 for guests too, so the frontend can check sign-in state without a console error.
func (a *API) me(w http.ResponseWriter, r *http.Request) {
	var resp userResponse
	if s := currentAuth(r); s != nil {
		resp.User = &s.User
	}
	writeJSON(w, http.StatusOK, resp)
}

func (a *API) authProviders(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"google": a.Google != nil})
}

func (a *API) requestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := a.Auth.RequestPasswordReset(r.Context(), in.Email); err != nil {
		a.writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "sent_if_registered"})
}

func (a *API) confirmPasswordReset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	user, token, err := a.Auth.ResetPassword(r.Context(), in.Token, in.Password, clientInfo(r))
	if err != nil {
		a.writeAuthError(w, err)
		return
	}
	a.setSessionCookie(w, token)
	writeJSON(w, http.StatusOK, userResponse{User: &user})
}

func (a *API) changePassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	s := currentAuth(r)
	if err := a.Auth.ChangePassword(r.Context(), s.User.ID, s.Session.ID, in.CurrentPassword, in.NewPassword); err != nil {
		a.writeAuthError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type sessionView struct {
	auth.Session
	Current bool `json:"current"`
}

func (a *API) listSessions(w http.ResponseWriter, r *http.Request) {
	s := currentAuth(r)
	sessions, err := a.Auth.ListSessions(r.Context(), s.User.ID)
	if err != nil {
		a.writeAuthError(w, err)
		return
	}
	views := make([]sessionView, len(sessions))
	for i, sess := range sessions {
		views[i] = sessionView{Session: sess, Current: sess.ID == s.Session.ID}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": views})
}

func (a *API) revokeSession(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "Session not found.")
		return
	}
	s := currentAuth(r)
	if err := a.Auth.RevokeSession(r.Context(), s.User.ID, id); err != nil {
		a.writeAuthError(w, err)
		return
	}
	if id == s.Session.ID {
		a.clearSessionCookie(w)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) revokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	s := currentAuth(r)
	n, err := a.Auth.RevokeOtherSessions(r.Context(), s.User.ID, s.Session.ID)
	if err != nil {
		a.writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"revoked": n})
}

type oauthFlow struct {
	State    string `json:"s"`
	Verifier string `json:"v"`
	Next     string `json:"n"`
}

func (a *API) googleStart(w http.ResponseWriter, r *http.Request) {
	if a.Google == nil {
		writeError(w, http.StatusNotFound, "Google sign-in is not configured.")
		return
	}
	flow := oauthFlow{State: auth.NewState(), Verifier: auth.NewPKCEVerifier(), Next: safeNext(r.URL.Query().Get("next"))}
	raw, _ := json.Marshal(flow)
	http.SetCookie(w, &http.Cookie{
		Name: oauthCookieName, Value: base64.RawURLEncoding.EncodeToString(raw), Path: oauthCookiePath,
		MaxAge: 600, HttpOnly: true, Secure: a.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, a.Google.AuthCodeURL(flow.State, flow.Verifier), http.StatusFound)
}

func (a *API) googleCallback(w http.ResponseWriter, r *http.Request) {
	if a.Google == nil {
		writeError(w, http.StatusNotFound, "Google sign-in is not configured.")
		return
	}
	fail := func(reason string, err error) {
		if err != nil {
			slog.Warn("google sign-in failed", "reason", reason, "err", err)
		}
		http.Redirect(w, r, "/login?error="+reason, http.StatusFound)
	}

	c, err := r.Cookie(oauthCookieName)
	http.SetCookie(w, &http.Cookie{Name: oauthCookieName, Value: "", Path: oauthCookiePath, MaxAge: -1, HttpOnly: true, Secure: a.CookieSecure})
	if err != nil {
		fail("google", errors.New("missing oauth cookie"))
		return
	}
	var flow oauthFlow
	raw, err := base64.RawURLEncoding.DecodeString(c.Value)
	if err == nil {
		err = json.Unmarshal(raw, &flow)
	}
	if err != nil || flow.State == "" {
		fail("google", errors.New("malformed oauth cookie"))
		return
	}

	q := r.URL.Query()
	if q.Get("error") != "" {
		fail("google_cancelled", nil)
		return
	}
	if subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(flow.State)) != 1 {
		fail("google", errors.New("state mismatch"))
		return
	}
	profile, err := a.Google.Exchange(r.Context(), q.Get("code"), flow.Verifier)
	if err != nil {
		fail("google", err)
		return
	}
	_, token, err := a.Auth.SignInWithGoogle(r.Context(), profile, clientInfo(r))
	switch {
	case errors.Is(err, auth.ErrGoogleEmailUnverified):
		fail("google_unverified", nil)
		return
	case errors.Is(err, auth.ErrEmailTaken):
		fail("google_conflict", nil)
		return
	case err != nil:
		fail("google", err)
		return
	}
	a.setSessionCookie(w, token)
	http.Redirect(w, r, flow.Next, http.StatusFound)
}

// safeNext only allows same-site relative paths, so ?next= cannot redirect to another website.
func safeNext(next string) string {
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.HasPrefix(next, "/\\") || strings.ContainsAny(next, "\r\n") {
		return defaultNextPath
	}
	u, err := url.Parse(next)
	if err != nil || u.Scheme != "" || u.Host != "" {
		return defaultNextPath
	}
	return next
}
