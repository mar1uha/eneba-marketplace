package httpapi

import (
	"net/http"
	"testing"
)

// Inputs found by fuzzing the API that crashed handlers with a 500. Each must get a clear answer.
func TestMalformedInputsGetClearAnswers(t *testing.T) {
	env := newTestEnv(t)
	offer := testOffer(t, env, 3)
	c := env.browser()
	env.register(c, env.email(), "correct-horse-battery")
	// 9,999,999,999 overflowed the database's int column.
	hugeAddedPrice := map[string]any{"items": []map[string]any{{"offer_id": offer, "quantity": 1, "added_price_cents": 9_999_999_999}}}

	cases := []struct {
		name, method, path string
		body               any
		want               int
	}{
		{"NUL byte in a product slug", "GET", "/api/products/%00", nil, http.StatusNotFound},
		{"slug that cannot exist", "GET", "/api/products/Hades%20II", nil, http.StatusNotFound},
		{"NUL byte in search text", "GET", "/api/products?q=hades%00", nil, http.StatusBadRequest},
		{"NUL byte in suggestions", "GET", "/api/search/suggestions?q=ha%00des", nil, http.StatusBadRequest},
		{"invalid UTF-8 in search text", "GET", "/api/products?q=a%ff", nil, http.StatusBadRequest},
		{"invalid UTF-8 in suggestions", "GET", "/api/search/suggestions?q=ab%c3%28", nil, http.StatusBadRequest},
		{"huge added price in a guest quote", "POST", "/api/cart/quote", hugeAddedPrice, http.StatusOK},
		{"huge added price in a merge", "POST", "/api/cart/merge", hugeAddedPrice, http.StatusOK},
	}
	for _, tc := range cases {
		if r := env.do(c, tc.method, tc.path, tc.body); r.status != tc.want {
			t.Errorf("%s: status %d, want %d (%v)", tc.name, r.status, tc.want, r.body)
		}
	}

	// An absurd "price when added" is ignored rather than shown as a price change.
	r := env.do(c, "POST", "/api/cart/quote", hugeAddedPrice)
	if line := r.body["lines"].([]any)[0].(map[string]any); line["added_price_cents"] != line["price_cents"] {
		t.Errorf("added price %v should fall back to the current price %v", line["added_price_cents"], line["price_cents"])
	}
}
