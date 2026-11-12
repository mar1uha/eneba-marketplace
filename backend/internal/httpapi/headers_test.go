package httpapi

import (
	"net/http"
	"testing"
)

// API responses carry personal data (account, cart, orders): browsers must not sniff them as another
// content type, and no cache may keep them. Found by checking the live headers: the proxy added
// "Cache-Control: public" because the API set none.
func TestAPIResponsesAreNotCachedOrSniffed(t *testing.T) {
	env := newTestEnv(t)
	c := env.browser()
	for _, path := range []string{"/api/health", "/api/auth/me", "/api/products/hades", "/api/products?q=hades", "/api/no-such-endpoint"} {
		req, _ := http.NewRequest("GET", env.srv.URL+path, nil)
		resp, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if got := resp.Header.Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control %q, want no-store", path, got)
		}
		if got := resp.Header.Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options %q, want nosniff", path, got)
		}
	}
}
