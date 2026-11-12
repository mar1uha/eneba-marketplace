package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"eneba-marketplace/backend/internal/auth"
	"eneba-marketplace/backend/internal/catalog"
	"eneba-marketplace/backend/internal/homepage"
)

func TestWriteServerError(t *testing.T) {
	rec := httptest.NewRecorder()
	writeServerError(rec, fmt.Errorf("query: %w", errors.New("boom")), "test failure", "internal error")
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("real failure: status %d, want 500", rec.Code)
	}

	rec = httptest.NewRecorder()
	writeServerError(rec, fmt.Errorf("query: %w", context.Canceled), "test failure", "internal error")
	if rec.Code != statusClientClosedRequest || rec.Body.Len() != 0 {
		t.Errorf("abandoned request: status %d body %q, want 499 and no body", rec.Code, rec.Body.String())
	}
}

// Browsers cancel in-flight requests when the page navigates (for example during the Google sign-in redirect).
// The database calls then fail with context.Canceled, which must not be reported as a server error.
func TestAbandonedRequestsAreNotServerErrors(t *testing.T) {
	env := newTestEnv(t)
	api := &API{
		DB:       env.pool,
		Homepage: homepage.NewService(env.pool, catalog.NewStore(env.pool)),
		Auth:     auth.NewService(env.pool, env.mailer, testOrigin),
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	rec := httptest.NewRecorder()
	api.homepage(rec, httptest.NewRequest(http.MethodGet, "/api/homepage", nil).WithContext(ctx))
	if rec.Code != statusClientClosedRequest {
		t.Errorf("homepage: status %d, want %d", rec.Code, statusClientClosedRequest)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil).WithContext(ctx)
	req.AddCookie(&http.Cookie{Name: api.sessionCookieName(), Value: "some-session-token"})
	rec = httptest.NewRecorder()
	api.loadSession(http.NotFoundHandler()).ServeHTTP(rec, req)
	if rec.Code != statusClientClosedRequest {
		t.Errorf("session lookup: status %d, want %d", rec.Code, statusClientClosedRequest)
	}
}
