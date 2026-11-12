package orders

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"eneba-marketplace/backend/internal/catalog"
	"eneba-marketplace/backend/internal/testdb"
)

var (
	okCard      = Card{Name: "Ada Lovelace", Number: "4242 4242 4242 4242", Expiry: "12/34", CVC: "123"}
	declineCard = Card{Name: "Ada Lovelace", Number: "4000 0000 0000 0002", Expiry: "12/34", CVC: "123"}
)

func TestCardCheck(t *testing.T) {
	now := time.Date(2026, 11, 12, 15, 0, 0, 0, time.UTC)
	card := func(edit func(*Card)) Card {
		c := okCard
		edit(&c)
		return c
	}

	ch, err := okCard.check(now)
	if err != nil || ch.brand != "visa" || ch.last4 != "4242" || ch.decline != nil {
		t.Errorf("4242: %+v, %v", ch, err)
	}
	if ch, _ := card(func(c *Card) { c.Number = "5555-5555-5555-4444" }).check(now); ch.brand != "mastercard" || ch.last4 != "4444" {
		t.Errorf("mastercard: %+v", ch)
	}
	if ch, _ := declineCard.check(now); ch.decline == nil || ch.decline.Code != "card_declined" {
		t.Errorf("decline card: %+v", ch)
	}
	if ch, _ := card(func(c *Card) { c.Number = "4000000000009995" }).check(now); ch.decline == nil || ch.decline.Code != "insufficient_funds" {
		t.Errorf("insufficient funds card: %+v", ch)
	}
	if _, err := card(func(c *Card) { c.Expiry = "11/26" }).check(now); err != nil {
		t.Errorf("a card is valid through its expiry month: %v", err)
	}

	cases := []struct {
		name, field string
		card        Card
	}{
		{"blank name", "name", card(func(c *Card) { c.Name = "  " })},
		{"checksum fails", "number", card(func(c *Card) { c.Number = "4242 4242 4242 4241" })},
		{"too short", "number", card(func(c *Card) { c.Number = "4242" })},
		{"letters", "number", card(func(c *Card) { c.Number = "4242 abcd 4242 4242" })},
		{"real-looking card", "number", card(func(c *Card) { c.Number = "4111 1111 1111 1111" })},
		{"bad expiry format", "expiry", card(func(c *Card) { c.Expiry = "1234" })},
		{"month 13", "expiry", card(func(c *Card) { c.Expiry = "13/30" })},
		{"expired", "expiry", card(func(c *Card) { c.Expiry = "10/26" })},
		{"short cvc", "cvc", card(func(c *Card) { c.CVC = "12" })},
	}
	for _, c := range cases {
		var ce *CardError
		if _, err := c.card.check(now); !errors.As(err, &ce) || ce.Field != c.field {
			t.Errorf("%s: got %v, want an error on %q", c.name, err, c.field)
		}
	}
}

type fixture struct {
	t      *testing.T
	svc    *Service
	pool   *pgxpool.Pool
	cheap  int64 // €10.00 offer
	pricey int64 // €20.00 offer
}

// setup creates a product with two offers and the given stock, so tests never touch the seeded catalog.
func setup(t *testing.T, cheapStock, priceyStock int) fixture {
	t.Helper()
	ctx := context.Background()
	pool := testdb.Pool(t, "orders")

	slug := "order-test-" + strings.ToLower(rand.Text()[:10])
	var productID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO products (slug, title, cover_url, banner_url, platform, region, msrp_cents)
		VALUES ($1, 'Order Test', 'https://cdn.test/c.jpg', 'https://cdn.test/b.jpg', 'steam', 'global', 1000)
		RETURNING id`, slug).Scan(&productID); err != nil {
		t.Fatal(err)
	}
	// Registered first, so it runs after the user cleanups that delete the orders referencing these offers.
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM products WHERE id = $1`, productID) })

	f := fixture{t: t, svc: NewService(pool), pool: pool}
	f.cheap = f.offer(productID, 1, 1000, cheapStock)
	f.pricey = f.offer(productID, 2, 2000, priceyStock)
	return f
}

func (f fixture) offer(productID, sellerID int64, price, stock int) int64 {
	f.t.Helper()
	var id int64
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO offers (product_id, seller_id, price_cents) VALUES ($1, $2, $3) RETURNING id`,
		productID, sellerID, price).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	if _, err := f.pool.Exec(context.Background(), `
		INSERT INTO digital_keys (offer_id, code)
		SELECT $1::bigint, 'TEST-' || $1::bigint || '-' || n FROM generate_series(1, $2) AS n`, id, stock); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f fixture) user() int64 {
	f.t.Helper()
	email := "orders-" + strings.ToLower(rand.Text()[:12]) + "@example.test"
	var id int64
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'tester', 'not-a-real-hash') RETURNING id`,
		email).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	f.t.Cleanup(func() { _, _ = f.pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id) })
	return id
}

func (f fixture) forSale(offerID int64) int {
	f.t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), `SELECT `+catalog.StockOf("$1::bigint"), offerID).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

func (f fixture) add(user, offer int64, qty int) Cart {
	f.t.Helper()
	c, err := f.svc.AddItem(context.Background(), user, offer, qty)
	if err != nil {
		f.t.Fatalf("add %d x offer %d: %v", qty, offer, err)
	}
	return c
}

func (f fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatal(err)
	}
}

func stockProblems(err error) []StockProblem {
	var se *StockError
	if errors.As(err, &se) {
		return se.Problems
	}
	return nil
}

func TestCartRules(t *testing.T) {
	f := setup(t, 5, 20)
	ctx := context.Background()
	u := f.user()

	c := f.add(u, f.cheap, 2)
	c = f.add(u, f.cheap, 1)
	if len(c.Lines) != 1 || c.Lines[0].Quantity != 3 || c.TotalCents != 3000 || c.ItemCount != 3 || c.Lines[0].Stock != 5 {
		t.Fatalf("after adding 2 + 1: %+v", c)
	}
	if _, err := f.svc.AddItem(ctx, u, f.cheap, 3); fmt.Sprint(stockProblems(err)) != fmt.Sprint([]StockProblem{{f.cheap, 5}}) {
		t.Errorf("adding past stock: %v", err)
	}
	f.add(u, f.pricey, 10)
	if _, err := f.svc.AddItem(ctx, u, f.pricey, 1); !errors.Is(err, ErrQuantityLimit) {
		t.Errorf("11th key of one offer: %v", err)
	}
	if _, err := f.svc.SetQuantity(ctx, u, f.cheap, 6); stockProblems(err) == nil {
		t.Errorf("setting past stock: %v", err)
	}
	if c, err := f.svc.SetQuantity(ctx, u, f.pricey, 1); err != nil || c.TotalCents != 3*1000+2000 {
		t.Errorf("set quantity: %+v, %v", c, err)
	}
	if _, err := f.svc.SetQuantity(ctx, u, 999_999_999, 1); !errors.Is(err, ErrNotFound) {
		t.Errorf("set quantity of a missing line: %v", err)
	}
	if _, err := f.svc.AddItem(ctx, u, 999_999_999, 1); !errors.Is(err, ErrOfferUnavailable) {
		t.Errorf("unknown offer: %v", err)
	}
	f.exec(`UPDATE offers SET is_active = false WHERE id = $1`, f.pricey)
	if _, err := f.svc.AddItem(ctx, u, f.pricey, 1); !errors.Is(err, ErrOfferUnavailable) {
		t.Errorf("inactive offer: %v", err)
	}
	c, _ = f.svc.Cart(ctx, u)
	if c.Lines[1].Available || c.TotalCents != 3000 {
		t.Errorf("an inactive line stays visible but is left out of the total: %+v", c)
	}
	if c, err := f.svc.RemoveItem(ctx, u, f.pricey); err != nil || len(c.Lines) != 1 {
		t.Errorf("remove: %+v, %v", c, err)
	}
}

func TestCartShowsPriceChanges(t *testing.T) {
	f := setup(t, 5, 5)
	u := f.user()
	f.add(u, f.cheap, 2)
	f.exec(`UPDATE offers SET price_cents = 1250 WHERE id = $1`, f.cheap)

	c, _ := f.svc.Cart(context.Background(), u)
	if l := c.Lines[0]; l.AddedPriceCents != 1000 || l.PriceCents != 1250 || l.LineTotalCents != 2500 || c.TotalCents != 2500 {
		t.Errorf("price change: %+v", l)
	}
}

func TestQuoteAndMergeGuestCart(t *testing.T) {
	f := setup(t, 5, 5)
	ctx := context.Background()
	guest := []Item{
		{OfferID: f.cheap, Quantity: 9},
		{OfferID: f.pricey, Quantity: 1, AddedPriceCents: 1500},
		{OfferID: 999_999_999, Quantity: 1},
		{OfferID: f.cheap, Quantity: 4},
		{OfferID: f.pricey, Quantity: 0},
	}

	q, err := f.svc.Quote(ctx, guest)
	if err != nil {
		t.Fatal(err)
	}
	if len(q.Lines) != 2 || q.Lines[0].Quantity != 10 || q.Lines[1].AddedPriceCents != 1500 || q.TotalCents != 10*1000+2000 {
		t.Errorf("quote: %+v", q)
	}
	if q.Lines[0].AddedPriceCents != 1000 {
		t.Errorf("unknown added price should default to the current price, got %d", q.Lines[0].AddedPriceCents)
	}

	u := f.user()
	f.add(u, f.cheap, 2)
	c, err := f.svc.Merge(ctx, u, guest)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Lines) != 2 || c.Lines[0].Quantity != MaxQuantity || c.Lines[1].Quantity != 1 || c.Lines[1].AddedPriceCents != 1500 {
		t.Errorf("merge: %+v", c)
	}
}

func TestCheckoutReservesThenPaymentDeliversKeys(t *testing.T) {
	f := setup(t, 5, 5)
	ctx := context.Background()
	u := f.user()
	f.add(u, f.cheap, 2)
	f.add(u, f.pricey, 1)

	o, err := f.svc.Checkout(ctx, u)
	if err != nil {
		t.Fatal(err)
	}
	if o.Status != "pending" || o.TotalCents != 4000 || len(o.Items) != 2 {
		t.Fatalf("order: %+v", o)
	}
	if left := o.ReservedUntil.Sub(o.ServerTime); left < 9*time.Minute || left > ReservationTTL {
		t.Errorf("reservation lasts %v", left)
	}
	if f.forSale(f.cheap) != 3 || f.forSale(f.pricey) != 4 {
		t.Errorf("keys not reserved: %d and %d for sale", f.forSale(f.cheap), f.forSale(f.pricey))
	}

	var decline *DeclineError
	if _, err := f.svc.Pay(ctx, u, o.ID, declineCard); !errors.As(err, &decline) || decline.Code != "card_declined" {
		t.Fatalf("declined card: %v", err)
	}
	if o, _ := f.svc.Order(ctx, u, o.ID); o.Status != "pending" || f.forSale(f.cheap) != 3 {
		t.Errorf("a decline keeps the order open and the keys reserved: %s, %d for sale", o.Status, f.forSale(f.cheap))
	}

	paid, err := f.svc.Pay(ctx, u, o.ID, okCard)
	if err != nil {
		t.Fatal(err)
	}
	if paid.Status != "paid" || paid.PaidAt == nil || paid.Payment == nil || paid.Payment.CardLast4 != "4242" {
		t.Errorf("paid order: %+v", paid)
	}
	for _, it := range paid.Items {
		if len(it.Keys) != it.Quantity {
			t.Errorf("item %d: %d keys for quantity %d", it.OfferID, len(it.Keys), it.Quantity)
		}
		for _, k := range it.Keys {
			if k.Code != nil {
				t.Errorf("key %d shown before it was revealed", k.ID)
			}
		}
	}
	if c, _ := f.svc.Cart(ctx, u); len(c.Lines) != 0 {
		t.Errorf("cart not emptied after payment: %+v", c)
	}

	// A second click charges nothing.
	again, err := f.svc.Pay(ctx, u, o.ID, okCard)
	var payments, sold int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM payments WHERE order_id = $1 AND status = 'succeeded'`, o.ID).Scan(&payments)
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM digital_keys WHERE offer_id IN ($1, $2) AND status = 'sold'`, f.cheap, f.pricey).Scan(&sold)
	if err != nil || again.Status != "paid" || payments != 1 || sold != 3 {
		t.Errorf("paying twice: %v, %d successful payments, %d keys sold", err, payments, sold)
	}

	// Later price changes never alter a placed order.
	f.exec(`UPDATE offers SET price_cents = 9900 WHERE id = $1`, f.cheap)
	if o, _ := f.svc.Order(ctx, u, o.ID); o.TotalCents != 4000 || o.Items[0].UnitPriceCents != 1000 {
		t.Errorf("order changed with the offer price: %+v", o)
	}
}

func TestCheckoutWithoutEnoughStockReservesNothing(t *testing.T) {
	f := setup(t, 1, 5)
	ctx := context.Background()
	u := f.user()
	f.add(u, f.pricey, 2)
	f.add(u, f.cheap, 1)
	f.exec(`UPDATE cart_items SET quantity = 3 WHERE user_id = $1 AND offer_id = $2`, u, f.cheap)

	_, err := f.svc.Checkout(ctx, u)
	if fmt.Sprint(stockProblems(err)) != fmt.Sprint([]StockProblem{{f.cheap, 1}}) {
		t.Fatalf("checkout: %v", err)
	}
	var orders int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM orders WHERE user_id = $1`, u).Scan(&orders)
	if orders != 0 || f.forSale(f.cheap) != 1 || f.forSale(f.pricey) != 5 {
		t.Errorf("failed checkout left %d orders and %d/%d keys for sale", orders, f.forSale(f.cheap), f.forSale(f.pricey))
	}
	if _, err := f.svc.Checkout(ctx, f.user()); !errors.Is(err, ErrEmptyCart) {
		t.Errorf("empty cart: %v", err)
	}
}

func TestLastKeyGoesToExactlyOneBuyer(t *testing.T) {
	f := setup(t, 1, 0)
	ctx := context.Background()
	buyers := make([]int64, 8)
	for i := range buyers {
		buyers[i] = f.user()
		f.add(buyers[i], f.cheap, 1)
	}

	var wg sync.WaitGroup
	results := make([]error, len(buyers))
	for i, u := range buyers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, results[i] = f.svc.Checkout(ctx, u)
		}()
	}
	wg.Wait()

	won, outOfStock := 0, 0
	for _, err := range results {
		switch {
		case err == nil:
			won++
		case stockProblems(err) != nil:
			outOfStock++
		default:
			t.Errorf("unexpected error: %v", err)
		}
	}
	if won != 1 || outOfStock != len(buyers)-1 || f.forSale(f.cheap) != 0 {
		t.Errorf("%d won, %d out of stock, %d keys left", won, outOfStock, f.forSale(f.cheap))
	}
}

func TestNewCheckoutReplacesTheOpenOne(t *testing.T) {
	f := setup(t, 5, 5)
	ctx := context.Background()
	u := f.user()
	f.add(u, f.cheap, 2)

	first, _ := f.svc.Checkout(ctx, u)
	second, err := f.svc.Checkout(ctx, u)
	if err != nil {
		t.Fatal(err)
	}
	if o, _ := f.svc.Order(ctx, u, first.ID); o.Status != "cancelled" || second.Status != "pending" {
		t.Errorf("first %s, second %s", o.Status, second.Status)
	}
	if f.forSale(f.cheap) != 3 {
		t.Errorf("%d keys for sale, want 3 (only the second checkout holds keys)", f.forSale(f.cheap))
	}
}

func TestExpiredReservationReturnsKeys(t *testing.T) {
	f := setup(t, 2, 5)
	ctx := context.Background()
	u := f.user()
	f.add(u, f.cheap, 2)
	o, _ := f.svc.Checkout(ctx, u)

	// Simulate the 10 minutes passing.
	f.exec(`UPDATE orders SET reserved_until = now() - interval '1 second' WHERE id = $1`, o.ID)
	f.exec(`UPDATE digital_keys SET reserved_until = now() - interval '1 second' WHERE offer_id = $1 AND status = 'reserved'`, f.cheap)
	if f.forSale(f.cheap) != 2 {
		t.Errorf("expired reservation still holds keys: %d for sale", f.forSale(f.cheap))
	}
	if o, _ := f.svc.Order(ctx, u, o.ID); o.Status != "expired" {
		t.Errorf("status %q, want expired", o.Status)
	}

	// Someone else buys the released keys; the first buyer's late payment must fail, not double-sell.
	other := f.user()
	f.add(other, f.cheap, 2)
	if _, err := f.svc.Checkout(ctx, other); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Pay(ctx, u, o.ID, okCard); !errors.Is(err, ErrReservationExpired) {
		t.Errorf("late payment: %v", err)
	}
	if _, err := f.svc.Pay(ctx, u, o.ID, okCard); !errors.Is(err, ErrOrderClosed) {
		t.Errorf("paying an expired order again: %v", err)
	}
}

func TestCancelReturnsKeys(t *testing.T) {
	f := setup(t, 3, 5)
	ctx := context.Background()
	u := f.user()
	f.add(u, f.cheap, 3)
	o, _ := f.svc.Checkout(ctx, u)

	c, err := f.svc.Cancel(ctx, u, o.ID)
	if err != nil || c.Status != "cancelled" || f.forSale(f.cheap) != 3 {
		t.Errorf("cancel: %v, status %s, %d for sale", err, c.Status, f.forSale(f.cheap))
	}
	if _, err := f.svc.Cancel(ctx, u, o.ID); err != nil {
		t.Errorf("cancelling twice: %v", err)
	}
	if _, err := f.svc.Pay(ctx, u, o.ID, okCard); !errors.Is(err, ErrOrderClosed) {
		t.Errorf("paying a cancelled order: %v", err)
	}

	o, _ = f.svc.Checkout(ctx, u)
	_, _ = f.svc.Pay(ctx, u, o.ID, okCard)
	if _, err := f.svc.Cancel(ctx, u, o.ID); !errors.Is(err, ErrOrderClosed) {
		t.Errorf("cancelling a paid order: %v", err)
	}
}

func TestRevealKeyAndPrivacy(t *testing.T) {
	f := setup(t, 2, 5)
	ctx := context.Background()
	u, stranger := f.user(), f.user()
	f.add(u, f.cheap, 1)
	o, _ := f.svc.Checkout(ctx, u)
	pendingKey := func() int64 {
		var id int64
		_ = f.pool.QueryRow(ctx, `SELECT id FROM digital_keys WHERE offer_id = $1 AND status = 'reserved'`, f.cheap).Scan(&id)
		return id
	}()
	if _, err := f.svc.RevealKey(ctx, u, o.ID, pendingKey); !errors.Is(err, ErrNotFound) {
		t.Errorf("revealing an unpaid key: %v", err)
	}

	paid, _ := f.svc.Pay(ctx, u, o.ID, okCard)
	keyID := paid.Items[0].Keys[0].ID
	k, err := f.svc.RevealKey(ctx, u, o.ID, keyID)
	if err != nil || k.Code == nil || !strings.HasPrefix(*k.Code, "TEST-") || k.RevealedAt == nil {
		t.Fatalf("reveal: %+v, %v", k, err)
	}
	time.Sleep(10 * time.Millisecond)
	if again, _ := f.svc.RevealKey(ctx, u, o.ID, keyID); !again.RevealedAt.Equal(*k.RevealedAt) {
		t.Errorf("first reveal time changed: %v -> %v", k.RevealedAt, again.RevealedAt)
	}
	if o, _ := f.svc.Order(ctx, u, o.ID); o.Items[0].Keys[0].Code == nil || *o.Items[0].Keys[0].Code != *k.Code {
		t.Errorf("revealed key not shown on the order")
	}

	if _, err := f.svc.Order(ctx, stranger, o.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user's order: %v", err)
	}
	if _, err := f.svc.RevealKey(ctx, stranger, o.ID, keyID); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user's key: %v", err)
	}
	if _, err := f.svc.Pay(ctx, stranger, o.ID, okCard); !errors.Is(err, ErrNotFound) {
		t.Errorf("paying another user's order: %v", err)
	}
}

func TestOrderHistoryListsPaidAndOpenOrders(t *testing.T) {
	f := setup(t, 10, 10)
	ctx := context.Background()
	u := f.user()

	f.add(u, f.cheap, 2)
	paid, _ := f.svc.Checkout(ctx, u)
	if _, err := f.svc.Pay(ctx, u, paid.ID, okCard); err != nil {
		t.Fatal(err)
	}
	f.add(u, f.pricey, 1)
	cancelled, _ := f.svc.Checkout(ctx, u)
	_, _ = f.svc.Cancel(ctx, u, cancelled.ID)
	open, _ := f.svc.Checkout(ctx, u)

	list, err := f.svc.Orders(ctx, u)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != open.ID || list[0].Status != "pending" || list[1].ID != paid.ID || list[1].Status != "paid" {
		t.Fatalf("history: %+v", list)
	}
	if list[1].ItemCount != 2 || len(list[1].Products) != 1 || list[1].Products[0].Title != "Order Test" {
		t.Errorf("summary: %+v", list[1])
	}
}
