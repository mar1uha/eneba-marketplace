package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"slices"
	"sync"
	"testing"
	"time"
)

// Stress tests: many clients hit the real router and database at once. They check what must hold
// under contention (no key sold twice, no double charge, no server error), and log response times.
// Skipped with -short.

// hit is a request helper that is safe to call from many goroutines (env.do fails the test directly).
func hit(env *testEnv, c *http.Client, method, path string, body any) (int, map[string]any, error) {
	var r io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		r = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, env.srv.URL+path, r)
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out, nil
}

// problems collects failures from many goroutines and reports them on the test goroutine.
type problems struct {
	mu   sync.Mutex
	list []string
}

func (p *problems) add(format string, args ...any) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.list = append(p.list, fmt.Sprintf(format, args...))
}

func (p *problems) expect(what string, want int, status int, body map[string]any, err error) {
	if err != nil || status != want {
		p.add("%s: status %d (want %d), err %v, body %v", what, status, want, err, body)
	}
}

func (p *problems) report(t *testing.T) {
	t.Helper()
	for i, s := range p.list {
		if i == 10 {
			t.Errorf("... and %d more", len(p.list)-10)
			break
		}
		t.Error(s)
	}
}

func parallel(n int, f func(i int)) {
	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() { f(i) })
	}
	wg.Wait()
}

func (e *testEnv) count(sql string, args ...any) int {
	e.t.Helper()
	var n int
	if err := e.pool.QueryRow(e.t.Context(), sql, args...).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func TestStressBuyersRaceForScarceKeys(t *testing.T) {
	if testing.Short() {
		t.Skip("stress test")
	}
	env := newTestEnv(t)
	const stock, buyers = 25, 60
	offer := testOffer(t, env, stock)
	emails := make([]string, buyers)
	for i := range emails {
		emails[i] = env.email()
	}
	clients := make([]*http.Client, buyers)
	want := make([]int, buyers)
	var p problems

	// 60 sign-ups at once, then each buyer puts 1-3 keys in the cart (demand 120 for 25 keys).
	parallel(buyers, func(i int) {
		clients[i], want[i] = env.browser(), 1+i%3
		status, body, err := hit(env, clients[i], "POST", "/api/auth/register", credentials{Email: emails[i], Password: "correct-horse-battery"})
		p.expect("register", 201, status, body, err)
		status, body, err = hit(env, clients[i], "POST", "/api/cart/items", map[string]any{"offer_id": offer, "quantity": want[i]})
		p.expect("add to cart", 200, status, body, err)
	})
	p.report(t)

	// Everyone checks out at the same moment.
	orders := make([]string, buyers)
	parallel(buyers, func(i int) {
		status, body, err := hit(env, clients[i], "POST", "/api/checkout", nil)
		switch {
		case err == nil && status == 201:
			orders[i] = fmt.Sprintf("/api/orders/%v", body["id"])
		case err == nil && status == 409 && body["code"] == "insufficient_stock":
		default:
			p.add("checkout: status %d, err %v, body %v", status, err, body)
		}
	})
	reserved := 0
	for i, o := range orders {
		if o != "" {
			reserved += want[i]
		}
	}
	if reserved > stock {
		t.Fatalf("reserved %d keys out of %d", reserved, stock)
	}
	if left := env.count(`SELECT count(*) FROM digital_keys WHERE offer_id = $1 AND status = 'available'`, offer); left+reserved != stock {
		t.Errorf("%d reserved + %d available != %d stock", reserved, left, stock)
	}

	// Winners pay at once; every third is declined first, and each clicks Pay three times.
	card := map[string]string{"name": "Ada", "number": "4242 4242 4242 4242", "expiry": "12/34", "cvc": "123"}
	declined := map[string]string{"name": "Ada", "number": "4000 0000 0000 0002", "expiry": "12/34", "cvc": "123"}
	parallel(buyers, func(i int) {
		if orders[i] == "" {
			return
		}
		if i%3 == 0 {
			status, body, err := hit(env, clients[i], "POST", orders[i]+"/pay", declined)
			p.expect("declined payment", 402, status, body, err)
		}
		parallel(3, func(int) {
			status, body, err := hit(env, clients[i], "POST", orders[i]+"/pay", card)
			p.expect("payment", 200, status, body, err)
		})
	})
	p.report(t)

	sold := env.count(`SELECT count(*) FROM digital_keys WHERE offer_id = $1 AND status = 'sold'`, offer)
	if sold != reserved {
		t.Errorf("%d keys sold, %d were reserved", sold, reserved)
	}
	if n := env.count(`
		SELECT count(*) FROM orders o
		WHERE o.status = 'paid' AND o.id IN (SELECT order_id FROM order_items WHERE offer_id = $1)
		  AND (SELECT count(*) FROM payments WHERE order_id = o.id AND status = 'succeeded') <> 1`, offer); n != 0 {
		t.Errorf("%d paid orders without exactly one successful payment", n)
	}
	if n := env.count(`
		SELECT count(*) FROM order_items oi
		WHERE oi.offer_id = $1
		  AND oi.quantity <> (SELECT count(*) FROM digital_keys WHERE order_item_id = oi.id AND status = 'sold')
		  AND (SELECT status FROM orders WHERE id = oi.order_id) = 'paid'`, offer); n != 0 {
		t.Errorf("%d paid order lines whose key count differs from their quantity", n)
	}
	t.Logf("%d buyers wanted %d keys; %d reserved and sold, %d left", buyers, 2*buyers, sold, stock-sold)
}

func TestStressDoubleClickStorms(t *testing.T) {
	if testing.Short() {
		t.Skip("stress test")
	}
	env := newTestEnv(t)
	offer := testOffer(t, env, 5)
	c := env.browser()
	env.register(c, env.email(), "correct-horse-battery")
	var p problems

	// 30 add-to-cart clicks at once for an offer with 5 keys.
	var added, refused int
	var mu sync.Mutex
	parallel(30, func(int) {
		status, body, err := hit(env, c, "POST", "/api/cart/items", map[string]any{"offer_id": offer, "quantity": 1})
		mu.Lock()
		defer mu.Unlock()
		switch {
		case err == nil && status == 200:
			added++
		case err == nil && status == 409:
			refused++
		default:
			p.add("add: status %d, err %v, body %v", status, err, body)
		}
	})
	if added != 5 || refused != 25 {
		t.Errorf("30 clicks: %d added, %d refused; want 5 and 25", added, refused)
	}
	if r := env.do(c, "GET", "/api/cart", nil); r.body["item_count"] != float64(5) {
		t.Errorf("cart: %v", r.body)
	}

	// 15 checkout clicks: the last one wins, the others are closed and hold no keys.
	parallel(15, func(int) {
		status, body, err := hit(env, c, "POST", "/api/checkout", nil)
		p.expect("checkout", 201, status, body, err)
	})
	user := int64(env.me(c)["id"].(float64))
	if n := env.count(`SELECT count(*) FROM orders WHERE user_id = $1 AND status = 'pending'`, user); n != 1 {
		t.Errorf("%d pending orders after 15 checkout clicks, want 1", n)
	}
	if n := env.count(`SELECT count(*) FROM digital_keys WHERE offer_id = $1 AND status = 'reserved'`, offer); n != 5 {
		t.Errorf("%d keys reserved, want 5", n)
	}

	// 20 Pay clicks on the open order: one charge, five keys sold.
	var orderID int
	if err := env.pool.QueryRow(t.Context(), `SELECT id FROM orders WHERE user_id = $1 AND status = 'pending'`, user).Scan(&orderID); err != nil {
		t.Fatal(err)
	}
	card := map[string]string{"name": "Ada", "number": "4242 4242 4242 4242", "expiry": "12/34", "cvc": "123"}
	parallel(20, func(int) {
		status, body, err := hit(env, c, "POST", fmt.Sprintf("/api/orders/%d/pay", orderID), card)
		p.expect("pay", 200, status, body, err)
	})
	p.report(t)
	if n := env.count(`SELECT count(*) FROM payments WHERE order_id = $1 AND status = 'succeeded'`, orderID); n != 1 {
		t.Errorf("%d successful payments for one order", n)
	}
	if n := env.count(`SELECT count(*) FROM digital_keys WHERE offer_id = $1 AND status = 'sold'`, offer); n != 5 {
		t.Errorf("%d keys sold, want 5", n)
	}
}

func TestStressMixedBrowsingTraffic(t *testing.T) {
	if testing.Short() {
		t.Skip("stress test")
	}
	env := newTestEnv(t)
	slugs := []string{"hades", "elden-ring", "cyberpunk-2077", "the-witcher-3-wild-hunt", "stardew-valley", "balatro"}
	queries := []string{"witcer", "eldn ring", "cyber punk", "assasins creed", "gta 5", "hollow kniht", "zelda", "a", "spiderman"}
	paths := func(r *rand.Rand) string {
		q := url.QueryEscape(queries[r.IntN(len(queries))])
		switch r.IntN(6) {
		case 0:
			return "/api/homepage"
		case 1:
			return "/api/products?page=" + fmt.Sprint(1+r.IntN(7)) + "&sort=price_asc"
		case 2:
			return "/api/products?q=" + q + "&platform=steam,gog&genre=rpg"
		case 3:
			return "/api/search/suggestions?q=" + q
		case 4:
			return "/api/products/" + slugs[r.IntN(len(slugs))]
		default:
			return "/api/products?max_price_cents=1500&region=global"
		}
	}

	const workers, duration = 32, 3 * time.Second
	var p problems
	var mu sync.Mutex
	var latencies []time.Duration
	deadline := time.Now().Add(duration)
	parallel(workers, func(i int) {
		r := rand.New(rand.NewPCG(uint64(i), 7))
		c := &http.Client{Timeout: 10 * time.Second}
		var local []time.Duration
		for time.Now().Before(deadline) {
			path := paths(r)
			start := time.Now()
			status, body, err := hit(env, c, "GET", path, nil)
			local = append(local, time.Since(start))
			if err != nil || status != 200 {
				p.add("GET %s: status %d, err %v, body %v", path, status, err, body)
			}
		}
		mu.Lock()
		latencies = append(latencies, local...)
		mu.Unlock()
	})
	p.report(t)

	slices.Sort(latencies)
	pct := func(q float64) time.Duration {
		return latencies[int(q*float64(len(latencies)-1))].Round(time.Millisecond)
	}
	t.Logf("%d requests from %d clients in %v (%.0f/s): p50 %v, p95 %v, p99 %v, max %v",
		len(latencies), workers, duration, float64(len(latencies))/duration.Seconds(), pct(0.5), pct(0.95), pct(0.99), latencies[len(latencies)-1])
}
