package httpapi

import (
	"context"
	"crypto/rand"
	"fmt"
	"maps"
	"strings"
	"testing"
)

// testOffer creates a product with one €10 offer holding stock keys; tests never use the seeded stock.
func testOffer(t *testing.T, env *testEnv, stock int) int64 {
	t.Helper()
	ctx := context.Background()
	slug := "http-shop-test-" + strings.ToLower(rand.Text()[:10])
	var productID, offerID int64
	if err := env.pool.QueryRow(ctx, `
		INSERT INTO products (slug, title, cover_url, banner_url, platform, region, msrp_cents)
		VALUES ($1, 'HTTP Shop Test', 'https://cdn.test/c.jpg', 'https://cdn.test/b.jpg', 'steam', 'global', 1000)
		RETURNING id`, slug).Scan(&productID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = env.pool.Exec(context.Background(), `DELETE FROM products WHERE id = $1`, productID) })
	if err := env.pool.QueryRow(ctx, `
		INSERT INTO offers (product_id, seller_id, price_cents) VALUES ($1, 1, 1000) RETURNING id`, productID).Scan(&offerID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.pool.Exec(ctx, `
		INSERT INTO digital_keys (offer_id, code)
		SELECT $1::bigint, 'HTTP-' || $1::bigint || '-' || n FROM generate_series(1, $2) AS n`, offerID, stock); err != nil {
		t.Fatal(err)
	}
	return offerID
}

var testCard = map[string]string{"name": "Ada Lovelace", "number": "4242 4242 4242 4242", "expiry": "12/34", "cvc": "123"}

func cardWith(field, value string) map[string]string {
	c := maps.Clone(testCard)
	c[field] = value
	return c
}

func TestShopFlowOverHTTP(t *testing.T) {
	env := newTestEnv(t)
	offer := testOffer(t, env, 3)
	items := map[string]any{"items": []map[string]any{{"offer_id": offer, "quantity": 2, "added_price_cents": 1000}}}
	buyer := env.browser()

	r := env.do(buyer, "POST", "/api/cart/quote", items)
	env.expect(r, 200, "guest quote")
	if r.body["item_count"] != float64(2) || r.body["total_cents"] != float64(2000) {
		t.Errorf("quote: %v", r.body)
	}
	env.expect(env.do(buyer, "GET", "/api/cart", nil), 401, "guest cart")
	env.expect(env.do(buyer, "POST", "/api/checkout", nil), 401, "guest checkout")

	env.register(buyer, env.email(), "correct-horse-battery")
	r = env.do(buyer, "POST", "/api/cart/merge", items)
	env.expect(r, 200, "merge")
	if r.body["item_count"] != float64(2) {
		t.Errorf("merged cart: %v", r.body)
	}
	r = env.do(buyer, "POST", "/api/cart/items", map[string]any{"offer_id": offer, "quantity": 2})
	env.expect(r, 409, "add past stock")
	if p := r.body["problems"].([]any)[0].(map[string]any); r.body["code"] != "insufficient_stock" || p["available"] != float64(3) {
		t.Errorf("stock error: %v", r.body)
	}
	env.expect(env.do(buyer, "PUT", fmt.Sprintf("/api/cart/items/%d", offer), map[string]any{"quantity": 11}), 400, "quantity 11")
	env.expect(env.do(buyer, "POST", "/api/checkout", nil, "Origin", "https://evil.test"), 403, "cross-site checkout")

	r = env.do(buyer, "POST", "/api/checkout", nil)
	env.expect(r, 201, "checkout")
	orderPath := fmt.Sprintf("/api/orders/%v", r.body["id"])
	if r.body["status"] != "pending" || r.body["reserved_until"] == nil || r.body["server_time"] == nil {
		t.Errorf("checkout: %v", r.body)
	}

	r = env.do(buyer, "POST", orderPath+"/pay", cardWith("number", "4242 4242 4242 4241"))
	env.expect(r, 400, "mistyped card")
	if r.body["field"] != "number" {
		t.Errorf("card error should name the field: %v", r.body)
	}
	r = env.do(buyer, "POST", orderPath+"/pay", cardWith("number", "4000 0000 0000 0002"))
	env.expect(r, 402, "declined card")
	if r.body["code"] != "card_declined" || r.body["error"] != "Your card was declined." {
		t.Errorf("decline: %v", r.body)
	}

	r = env.do(buyer, "POST", orderPath+"/pay", testCard)
	env.expect(r, 200, "pay")
	item := r.body["items"].([]any)[0].(map[string]any)
	key := item["keys"].([]any)[0].(map[string]any)
	if r.body["status"] != "paid" || key["code"] != nil || len(item["keys"].([]any)) != 2 {
		t.Fatalf("paid order: %v", r.body)
	}
	r = env.do(buyer, "POST", fmt.Sprintf("%s/keys/%v/reveal", orderPath, key["id"]), nil)
	env.expect(r, 200, "reveal")
	if code, _ := r.body["code"].(string); !strings.HasPrefix(code, "HTTP-") {
		t.Errorf("revealed key: %v", r.body)
	}

	r = env.do(buyer, "GET", "/api/orders", nil)
	env.expect(r, 200, "list orders")
	if list := r.body["orders"].([]any); len(list) != 1 {
		t.Errorf("orders: %v", list)
	}
	if r = env.do(buyer, "GET", "/api/cart", nil); r.body["item_count"] != float64(0) {
		t.Errorf("cart after payment: %v", r.body)
	}

	stranger := env.browser()
	env.register(stranger, env.email(), "correct-horse-battery")
	env.expect(env.do(stranger, "GET", orderPath, nil), 404, "another user's order")
	env.expect(env.do(stranger, "POST", orderPath+"/pay", testCard), 404, "paying another user's order")
	env.expect(env.do(buyer, "GET", "/api/orders/not-a-number", nil), 404, "bad order id")
}

func TestProductDetailEndpoint(t *testing.T) {
	env := newTestEnv(t)
	c := env.browser()

	r := env.do(c, "GET", "/api/products/hades", nil)
	env.expect(r, 200, "product")
	if r.body["title"] != "Hades" || len(r.body["editions"].([]any)) != 2 || len(r.body["offers"].([]any)) == 0 {
		t.Errorf("product: %v", r.body)
	}
	env.expect(env.do(c, "GET", "/api/products/no-such-game", nil), 404, "unknown product")
}
