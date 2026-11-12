package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"eneba-marketplace/backend/internal/auth"
	"eneba-marketplace/backend/internal/catalog"
	"eneba-marketplace/backend/internal/homepage"
	"eneba-marketplace/backend/internal/orders"
	"eneba-marketplace/backend/internal/testdb"
)

const testOrigin = "http://app.test"

type captureMailer struct {
	mu    sync.Mutex
	links map[string]string
}

func (m *captureMailer) SendPasswordReset(_ context.Context, to, link string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.links[to] = link
	return nil
}

func (m *captureMailer) link(email string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.links[email]
}

// fakeGoogle stands in for Google's token and userinfo endpoints. It only issues a token
// when the PKCE verifier matches the challenge sent in the authorization request.
type fakeGoogle struct {
	srv    *httptest.Server
	mu     sync.Mutex
	grants map[string]fakeGrant
}

type fakeGrant struct {
	challenge string
	profile   map[string]any
}

func newFakeGoogle(t *testing.T) *fakeGoogle {
	f := &fakeGoogle{grants: map[string]fakeGrant{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f.mu.Lock()
		g, ok := f.grants[r.Form.Get("code")]
		f.mu.Unlock()
		sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
		if !ok || base64.RawURLEncoding.EncodeToString(sum[:]) != g.challenge || r.Form.Get("client_secret") != "test-secret" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":"invalid_grant"}`)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"access_token": "at-" + r.Form.Get("code"), "token_type": "Bearer", "expires_in": 3600})
	})
	mux.HandleFunc("GET /userinfo", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		g, ok := f.grants[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer at-")]
		f.mu.Unlock()
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		writeJSON(w, http.StatusOK, g.profile)
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

type testEnv struct {
	t      *testing.T
	srv    *httptest.Server
	pool   *pgxpool.Pool
	mailer *captureMailer
	google *fakeGoogle
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	pool := testdb.Pool(t, "httpapi")
	env := &testEnv{t: t, pool: pool, mailer: &captureMailer{links: map[string]string{}}, google: newFakeGoogle(t)}
	store := catalog.NewStore(pool)
	api := &API{
		DB:       pool,
		Catalog:  store,
		Orders:   orders.NewService(pool),
		Homepage: homepage.NewService(pool, store),
		Auth:     auth.NewService(pool, env.mailer, testOrigin),
		Google: auth.NewGoogleOAuth("test-client", "test-secret", testOrigin+"/api/auth/google/callback", auth.GoogleEndpoints{
			AuthURL: env.google.srv.URL + "/auth", TokenURL: env.google.srv.URL + "/token", UserinfoURL: env.google.srv.URL + "/userinfo",
		}),
	}
	env.srv = httptest.NewServer(NewRouter(api, []string{testOrigin}))
	t.Cleanup(env.srv.Close)
	return env
}

// browser is an HTTP client with its own cookie jar, like a separate device.
func (e *testEnv) browser() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func (e *testEnv) email() string {
	email := "u-" + strings.ToLower(rand.Text()[:12]) + "@example.test"
	e.t.Cleanup(func() { _, _ = e.pool.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email) })
	return email
}

type result struct {
	status int
	body   map[string]any
	header http.Header
}

func (e *testEnv) do(c *http.Client, method, path string, body any, headers ...string) result {
	e.t.Helper()
	var r io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		r = strings.NewReader(string(raw))
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	resp, err := c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	out := result{status: resp.StatusCode, header: resp.Header}
	_ = json.NewDecoder(resp.Body).Decode(&out.body)
	return out
}

func (e *testEnv) expect(r result, status int, context string) {
	e.t.Helper()
	if r.status != status {
		e.t.Fatalf("%s: status %d, want %d (body %v)", context, r.status, status, r.body)
	}
}

// me returns the signed-in user's fields, or nil for a guest.
func (e *testEnv) me(c *http.Client) map[string]any {
	e.t.Helper()
	r := e.do(c, "GET", "/api/auth/me", nil)
	e.expect(r, 200, "GET /me")
	user, _ := r.body["user"].(map[string]any)
	return user
}

func (e *testEnv) register(c *http.Client, email, password string) map[string]any {
	e.t.Helper()
	r := e.do(c, "POST", "/api/auth/register", credentials{Email: email, Password: password})
	e.expect(r, 201, "register")
	return r.body["user"].(map[string]any)
}

func (e *testEnv) login(c *http.Client, email, password string) result {
	e.t.Helper()
	return e.do(c, "POST", "/api/auth/login", credentials{Email: email, Password: password})
}

func TestRegisterLoginLogout(t *testing.T) {
	e := newTestEnv(t)
	email := e.email()
	c := e.browser()

	e.expect(e.do(c, "GET", "/api/orders", nil), 401, "orders as guest")
	if e.me(c) != nil {
		t.Fatal("guest reported as signed in")
	}

	user := e.register(c, email, "first-password")
	if user["email"] != email || user["has_password"] != true || user["google_linked"] != false {
		t.Errorf("unexpected user: %v", user)
	}
	if e.me(c)["email"] != email {
		t.Fatal("not signed in after register")
	}
	e.expect(e.do(c, "GET", "/api/orders", nil), 200, "orders when signed in")

	e.expect(e.do(c, "POST", "/api/auth/logout", nil), 204, "logout")
	if e.me(c) != nil {
		t.Fatal("still signed in after logout")
	}
	e.expect(e.do(c, "GET", "/api/orders", nil), 401, "orders after logout")

	wrong := e.login(c, email, "not-the-password")
	unknown := e.login(c, e.email(), "first-password")
	e.expect(wrong, 401, "wrong password")
	e.expect(unknown, 401, "unknown email")
	if wrong.body["error"] != unknown.body["error"] {
		t.Errorf("error messages reveal whether the account exists: %q vs %q", wrong.body["error"], unknown.body["error"])
	}

	e.expect(e.login(c, "  "+strings.ToUpper(email)+" ", "first-password"), 200, "login with different case")
	if e.me(c)["email"] != email {
		t.Fatal("not signed in after login")
	}
}

func TestRegisterValidation(t *testing.T) {
	e := newTestEnv(t)
	email := e.email()
	e.register(e.browser(), email, "first-password")

	cases := []struct {
		name, email, password, field string
		status                       int
	}{
		{"duplicate email", strings.ToUpper(email), "another-password", "email", 409},
		{"invalid email", "not-an-email", "first-password", "email", 400},
		{"short password", e.email(), "short", "password", 400},
	}
	for _, tc := range cases {
		r := e.do(e.browser(), "POST", "/api/auth/register", credentials{Email: tc.email, Password: tc.password})
		e.expect(r, tc.status, tc.name)
		if r.body["field"] != tc.field {
			t.Errorf("%s: field %v, want %s", tc.name, r.body["field"], tc.field)
		}
	}
}

func TestSessionCookieAttributes(t *testing.T) {
	e := newTestEnv(t)
	r := e.do(e.browser(), "POST", "/api/auth/register", credentials{Email: e.email(), Password: "first-password"})
	e.expect(r, 201, "register")
	cookie := r.header.Get("Set-Cookie")
	for _, want := range []string{"eneba_session=", "Path=/", "Max-Age=1209600", "HttpOnly", "SameSite=Lax"} {
		if !strings.Contains(cookie, want) {
			t.Errorf("Set-Cookie %q is missing %q", cookie, want)
		}
	}
}

func TestCrossSiteAndContentTypeProtection(t *testing.T) {
	e := newTestEnv(t)
	email := e.email()
	c := e.browser()
	e.register(c, email, "first-password")

	e.expect(e.do(c, "POST", "/api/auth/logout", nil, "Origin", "http://evil.test"), 403, "cross-site logout")
	if e.me(c) == nil {
		t.Fatal("cross-site request signed the user out")
	}
	e.expect(e.do(c, "POST", "/api/auth/login", credentials{Email: email, Password: "first-password"}, "Origin", testOrigin), 200, "same-site login")

	req, _ := http.NewRequest("POST", e.srv.URL+"/api/auth/login", strings.NewReader(`{"email":"`+email+`","password":"first-password"}`))
	req.Header.Set("Content-Type", "text/plain")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnsupportedMediaType {
		t.Errorf("form-style POST got %d, want 415", resp.StatusCode)
	}
}

func TestPasswordReset(t *testing.T) {
	e := newTestEnv(t)
	email := e.email()
	laptop, phone := e.browser(), e.browser()
	e.register(laptop, email, "old-password")
	e.expect(e.login(phone, email, "old-password"), 200, "second device login")

	stranger := e.email()
	e.expect(e.do(e.browser(), "POST", "/api/auth/password-reset/request", map[string]string{"email": stranger}), 202, "reset unknown email")
	if e.mailer.link(stranger) != "" {
		t.Fatal("reset email sent for an unregistered address")
	}

	e.expect(e.do(e.browser(), "POST", "/api/auth/password-reset/request", map[string]string{"email": email}), 202, "reset request")
	link, err := url.Parse(e.mailer.link(email))
	if err != nil || !strings.HasPrefix(link.String(), testOrigin+"/reset-password?token=") {
		t.Fatalf("unexpected reset link %q", e.mailer.link(email))
	}
	token := link.Query().Get("token")

	resetter := e.browser()
	r := e.do(resetter, "POST", "/api/auth/password-reset/confirm", map[string]string{"token": token, "password": "short"})
	e.expect(r, 400, "reset with weak password")
	if r.body["field"] != "password" {
		t.Errorf("weak password error on field %v", r.body["field"])
	}

	e.expect(e.do(resetter, "POST", "/api/auth/password-reset/confirm", map[string]string{"token": token, "password": "new-password"}), 200, "reset")
	if e.me(resetter)["email"] != email {
		t.Error("not signed in after reset")
	}
	if e.me(laptop) != nil || e.me(phone) != nil {
		t.Error("old sessions survived a password reset")
	}

	e.expect(e.do(e.browser(), "POST", "/api/auth/password-reset/confirm", map[string]string{"token": token, "password": "third-password"}), 400, "token reuse")
	e.expect(e.login(e.browser(), email, "old-password"), 401, "old password after reset")
	e.expect(e.login(e.browser(), email, "new-password"), 200, "new password after reset")

	e.expect(e.do(e.browser(), "POST", "/api/auth/password-reset/request", map[string]string{"email": email}), 202, "second reset request")
	expired := e.mailer.link(email)
	if _, err := e.pool.Exec(context.Background(),
		`UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM users WHERE email = $1)`, email); err != nil {
		t.Fatal(err)
	}
	expiredURL, _ := url.Parse(expired)
	e.expect(e.do(e.browser(), "POST", "/api/auth/password-reset/confirm",
		map[string]string{"token": expiredURL.Query().Get("token"), "password": "third-password"}), 400, "expired token")
}

func TestChangePasswordAndSessionManagement(t *testing.T) {
	e := newTestEnv(t)
	email := e.email()
	laptop, phone := e.browser(), e.browser()
	e.register(laptop, email, "old-password")
	e.expect(e.login(phone, email, "old-password"), 200, "phone login")

	sessions := e.do(laptop, "GET", "/api/auth/sessions", nil).body["sessions"].([]any)
	if len(sessions) != 2 {
		t.Fatalf("got %d sessions, want 2", len(sessions))
	}
	current := 0
	for _, s := range sessions {
		if s.(map[string]any)["current"] == true {
			current++
		}
	}
	if current != 1 {
		t.Errorf("%d sessions marked current, want 1", current)
	}

	r := e.do(laptop, "POST", "/api/auth/password", map[string]string{"current_password": "wrong-password", "new_password": "new-password"})
	e.expect(r, 400, "change with wrong current password")
	if r.body["field"] != "current_password" {
		t.Errorf("error on field %v, want current_password", r.body["field"])
	}

	e.expect(e.do(laptop, "POST", "/api/auth/password", map[string]string{"current_password": "old-password", "new_password": "new-password"}), 204, "change password")
	if e.me(laptop) == nil {
		t.Error("changing the password signed out the current device")
	}
	if e.me(phone) != nil {
		t.Error("other device still signed in after password change")
	}

	e.expect(e.login(phone, email, "new-password"), 200, "phone login with new password")
	var phoneSessionID float64
	for _, s := range e.do(laptop, "GET", "/api/auth/sessions", nil).body["sessions"].([]any) {
		if s := s.(map[string]any); s["current"] == false {
			phoneSessionID = s["id"].(float64)
		}
	}
	e.expect(e.do(laptop, "DELETE", "/api/auth/sessions/"+jsonNumber(phoneSessionID), nil), 204, "revoke phone session")
	if e.me(phone) != nil {
		t.Error("revoked session still works")
	}
	e.expect(e.do(laptop, "DELETE", "/api/auth/sessions/"+jsonNumber(phoneSessionID), nil), 404, "revoke already revoked session")

	e.expect(e.login(phone, email, "new-password"), 200, "phone login again")
	r = e.do(laptop, "POST", "/api/auth/sessions/revoke-others", nil)
	e.expect(r, 200, "revoke others")
	if r.body["revoked"] != float64(1) || e.me(phone) != nil || e.me(laptop) == nil {
		t.Errorf("revoke-others: revoked=%v phone=%v laptop=%v", r.body["revoked"], e.me(phone), e.me(laptop))
	}

	// One user cannot revoke another user's session.
	intruder := e.browser()
	e.register(intruder, e.email(), "intruder-password")
	laptopID := e.do(laptop, "GET", "/api/auth/sessions", nil).body["sessions"].([]any)[0].(map[string]any)["id"].(float64)
	e.expect(e.do(intruder, "DELETE", "/api/auth/sessions/"+jsonNumber(laptopID), nil), 404, "revoke foreign session")
	if e.me(laptop) == nil {
		t.Error("another user revoked this user's session")
	}
}

func jsonNumber(f float64) string {
	return strconv.FormatInt(int64(f), 10)
}

// googleSignIn runs the browser side of the OAuth flow: start, "consent" at the fake Google, callback.
func (e *testEnv) googleSignIn(c *http.Client, next string, profile map[string]any) result {
	e.t.Helper()
	start := e.do(c, "GET", "/api/auth/google/start?next="+url.QueryEscape(next), nil)
	e.expect(start, 302, "google start")
	loc, err := url.Parse(start.header.Get("Location"))
	if err != nil {
		e.t.Fatal(err)
	}
	q := loc.Query()
	if q.Get("code_challenge_method") != "S256" || q.Get("client_id") != "test-client" || !strings.Contains(q.Get("scope"), "email") {
		e.t.Fatalf("authorization URL missing PKCE or client parameters: %s", loc)
	}
	code := "code-" + strings.ToLower(rand.Text()[:10])
	e.google.mu.Lock()
	e.google.grants[code] = fakeGrant{challenge: q.Get("code_challenge"), profile: profile}
	e.google.mu.Unlock()
	return e.do(c, "GET", "/api/auth/google/callback?code="+code+"&state="+url.QueryEscape(q.Get("state")), nil)
}

func googleProfile(email string, verified bool, name string) map[string]any {
	return map[string]any{"sub": "g-" + rand.Text(), "email": email, "email_verified": verified, "name": name}
}

func TestGoogleSignInCreatesAndReturnsAccount(t *testing.T) {
	e := newTestEnv(t)
	email := e.email()
	profile := googleProfile(email, true, "Ada Lovelace")

	c := e.browser()
	r := e.googleSignIn(c, "/account/orders", profile)
	e.expect(r, 302, "callback")
	if loc := r.header.Get("Location"); loc != "/account/orders" {
		t.Errorf("redirected to %q, want /account/orders", loc)
	}
	user := e.me(c)
	if user["display_name"] != "Ada Lovelace" || user["google_linked"] != true || user["has_password"] != false {
		t.Fatalf("unexpected google user: %v", user)
	}

	again := e.browser()
	e.googleSignIn(again, "/", profile)
	if e.me(again)["id"] != user["id"] {
		t.Error("returning Google user got a different account")
	}

	// A Google-only account can set a password without knowing a current one.
	e.expect(e.do(c, "POST", "/api/auth/password", map[string]string{"new_password": "now-has-password"}), 204, "set first password")
	e.expect(e.login(e.browser(), email, "now-has-password"), 200, "password login after setting one")
}

func TestGoogleLinkingProtectsAgainstPreRegisteredAccounts(t *testing.T) {
	e := newTestEnv(t)

	// Attacker registers the victim's email with a password before the victim ever signs up.
	victimEmail := e.email()
	attacker := e.browser()
	e.register(attacker, victimEmail, "attacker-password")

	victim := e.browser()
	e.googleSignIn(victim, "/", googleProfile(victimEmail, true, "Victim"))
	if u := e.me(victim); u == nil || u["google_linked"] != true || u["has_password"] != false {
		t.Fatalf("victim not signed in with a password-free linked account: %v", u)
	}
	if e.me(attacker) != nil {
		t.Error("attacker session survived Google linking of an unverified account")
	}
	e.expect(e.login(e.browser(), victimEmail, "attacker-password"), 401, "attacker password after linking")

	// An account whose email is already verified keeps its password when Google is linked.
	ownerEmail := e.email()
	owner := e.browser()
	e.register(owner, ownerEmail, "owner-password")
	if _, err := e.pool.Exec(context.Background(), `UPDATE users SET email_verified_at = now() WHERE email = $1`, ownerEmail); err != nil {
		t.Fatal(err)
	}
	e.googleSignIn(e.browser(), "/", googleProfile(ownerEmail, true, "Owner"))
	e.expect(e.login(e.browser(), ownerEmail, "owner-password"), 200, "verified owner keeps password")
	if e.me(owner) == nil {
		t.Error("verified owner's session was revoked by linking")
	}
}

func TestGoogleSignInFailures(t *testing.T) {
	e := newTestEnv(t)

	cases := []struct {
		name    string
		run     func(c *http.Client) result
		wantLoc string
	}{
		{"unverified email", func(c *http.Client) result {
			return e.googleSignIn(c, "/", googleProfile(e.email(), false, "x"))
		}, "/login?error=google_unverified"},
		{"user cancelled", func(c *http.Client) result {
			start := e.do(c, "GET", "/api/auth/google/start", nil)
			state, _ := url.Parse(start.header.Get("Location"))
			return e.do(c, "GET", "/api/auth/google/callback?error=access_denied&state="+state.Query().Get("state"), nil)
		}, "/login?error=google_cancelled"},
		{"forged state", func(c *http.Client) result {
			e.do(c, "GET", "/api/auth/google/start", nil)
			return e.do(c, "GET", "/api/auth/google/callback?code=anything&state=forged", nil)
		}, "/login?error=google"},
		{"no flow cookie", func(c *http.Client) result {
			return e.do(c, "GET", "/api/auth/google/callback?code=anything&state=anything", nil)
		}, "/login?error=google"},
	}
	for _, tc := range cases {
		c := e.browser()
		r := tc.run(c)
		e.expect(r, 302, tc.name)
		if loc := r.header.Get("Location"); loc != tc.wantLoc {
			t.Errorf("%s: redirected to %q, want %q", tc.name, loc, tc.wantLoc)
		}
		if e.me(c) != nil {
			t.Errorf("%s: user signed in after a failed flow", tc.name)
		}
	}

	c := e.browser()
	r := e.googleSignIn(c, "https://evil.test/phish", googleProfile(e.email(), true, "x"))
	if loc := r.header.Get("Location"); loc != "/" {
		t.Errorf("open redirect: next=https://evil.test led to %q", loc)
	}
}

func TestSafeNext(t *testing.T) {
	cases := map[string]string{
		"/account/orders?tab=1": "/account/orders?tab=1",
		"":                      "/",
		"account":               "/",
		"//evil.test":           "/",
		"/\\evil.test":          "/",
		"https://evil.test":     "/",
		"/ok\r\nSet-Cookie: x":  "/",
	}
	for in, want := range cases {
		if got := safeNext(in); got != want {
			t.Errorf("safeNext(%q) = %q, want %q", in, got, want)
		}
	}
}
