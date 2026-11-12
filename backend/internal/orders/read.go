package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Order returns one of the user's orders in one round trip; other users' orders are reported as not found.
func (s *Service) Order(ctx context.Context, userID, orderID int64) (Order, error) {
	batch := &pgx.Batch{}
	batch.Queue(`
		SELECT o.id, `+statusSQL+`, o.total_cents, o.created_at, o.reserved_until, o.paid_at, now()
		FROM orders o WHERE o.id = $1 AND o.user_id = $2`, orderID, userID)
	batch.Queue(`
		SELECT oi.id, oi.offer_id, p.slug, p.title, p.cover_url, p.platform, p.region, s.name, oi.unit_price_cents, oi.quantity
		FROM order_items oi
		JOIN offers ofr ON ofr.id = oi.offer_id
		JOIN products p ON p.id = ofr.product_id
		JOIN sellers s ON s.id = ofr.seller_id
		WHERE oi.order_id = $1 ORDER BY oi.id`, orderID)
	batch.Queue(`
		SELECT k.order_item_id, k.id, CASE WHEN k.revealed_at IS NOT NULL THEN k.code END, k.revealed_at
		FROM digital_keys k JOIN order_items oi ON oi.id = k.order_item_id
		WHERE oi.order_id = $1 AND k.status = 'sold' ORDER BY k.id`, orderID)
	batch.Queue(`SELECT card_brand, card_last4 FROM payments WHERE order_id = $1 AND status = 'succeeded'`, orderID)
	br := s.db.SendBatch(ctx, batch)
	defer br.Close()

	var o Order
	err := br.QueryRow().Scan(&o.ID, &o.Status, &o.TotalCents, &o.CreatedAt, &o.ReservedUntil, &o.PaidAt, &o.ServerTime)
	if errors.Is(err, pgx.ErrNoRows) {
		return o, ErrNotFound
	}
	if err != nil {
		return o, fmt.Errorf("load order: %w", err)
	}

	rows, _ := br.Query()
	if o.Items, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (OrderItem, error) {
		it := OrderItem{Keys: []Key{}}
		return it, row.Scan(&it.ID, &it.OfferID, &it.Product.Slug, &it.Product.Title, &it.Product.CoverURL,
			&it.Product.Platform, &it.Product.Region, &it.SellerName, &it.UnitPriceCents, &it.Quantity)
	}); err != nil {
		return o, fmt.Errorf("load order items: %w", err)
	}

	byItem := map[int64]int{}
	for i, it := range o.Items {
		byItem[it.ID] = i
	}
	rows, _ = br.Query()
	var itemID int64
	var k Key
	if _, err := pgx.ForEachRow(rows, []any{&itemID, &k.ID, &k.Code, &k.RevealedAt}, func() error {
		i := byItem[itemID]
		o.Items[i].Keys = append(o.Items[i].Keys, k)
		return nil
	}); err != nil {
		return o, fmt.Errorf("load keys: %w", err)
	}

	var p PaymentSummary
	switch err := br.QueryRow().Scan(&p.CardBrand, &p.CardLast4); {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return o, fmt.Errorf("load payment: %w", err)
	default:
		o.Payment = &p
	}
	return o, nil
}

// Orders lists the user's paid orders and the one awaiting payment, newest first. Cancelled and
// expired checkouts are left out; they never took money or delivered keys.
func (s *Service) Orders(ctx context.Context, userID int64) ([]OrderSummary, error) {
	rows, _ := s.db.Query(ctx, `
		SELECT o.id, `+statusSQL+`, o.total_cents, o.created_at,
		       (SELECT sum(quantity)::int FROM order_items WHERE order_id = o.id),
		       (SELECT json_agg(json_build_object('slug', p.slug, 'title', p.title, 'cover_url', p.cover_url,
		                                          'platform', p.platform, 'region', p.region) ORDER BY oi.id)
		        FROM order_items oi JOIN offers ofr ON ofr.id = oi.offer_id JOIN products p ON p.id = ofr.product_id
		        WHERE oi.order_id = o.id)
		FROM orders o
		WHERE o.user_id = $1 AND (o.status = 'paid' OR (o.status = 'pending' AND o.reserved_until >= now()))
		ORDER BY o.created_at DESC, o.id DESC
		LIMIT 100`, userID)
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (OrderSummary, error) {
		var o OrderSummary
		return o, row.Scan(&o.ID, &o.Status, &o.TotalCents, &o.CreatedAt, &o.ItemCount, &o.Products)
	})
	if err != nil {
		return nil, fmt.Errorf("list orders: %w", err)
	}
	return list, nil
}

// RevealKey returns a purchased key's code and records when it was first shown.
func (s *Service) RevealKey(ctx context.Context, userID, orderID, keyID int64) (Key, error) {
	var k Key
	var code string
	var revealedAt time.Time
	err := s.db.QueryRow(ctx, `
		UPDATE digital_keys k SET revealed_at = coalesce(k.revealed_at, now())
		FROM order_items oi JOIN orders o ON o.id = oi.order_id
		WHERE k.id = $3 AND k.order_item_id = oi.id AND oi.order_id = $2 AND o.user_id = $1 AND k.status = 'sold'
		RETURNING k.id, k.code, k.revealed_at`, userID, orderID, keyID).Scan(&k.ID, &code, &revealedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return k, ErrNotFound
	}
	if err != nil {
		return k, fmt.Errorf("reveal key: %w", err)
	}
	k.Code, k.RevealedAt = &code, &revealedAt
	return k, nil
}
