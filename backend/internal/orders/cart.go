package orders

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"eneba-marketplace/backend/internal/catalog"
)

// ErrQuantityLimit means a line would exceed MaxQuantity keys.
var ErrQuantityLimit = errors.New("quantity limit reached")

// maxAddedPriceCents bounds the browser-supplied "price when added" (€100,000) well inside the int column.
const maxAddedPriceCents = 10_000_000

// Item is a cart line as a guest's browser stores it.
type Item struct {
	OfferID  int64 `json:"offer_id"`
	Quantity int   `json:"quantity"`
	// AddedPriceCents is the price when added; 0 when unknown.
	AddedPriceCents int `json:"added_price_cents"`
}

type CartLine struct {
	OfferID  int64 `json:"offer_id"`
	Quantity int   `json:"quantity"`
	// PriceCents is the current price; AddedPriceCents the price when the line was added.
	PriceCents      int        `json:"price_cents"`
	AddedPriceCents int        `json:"added_price_cents"`
	LineTotalCents  int        `json:"line_total_cents"`
	Stock           int        `json:"stock"`
	Available       bool       `json:"available"`
	Product         ProductRef `json:"product"`
	Seller          SellerRef  `json:"seller"`
}

type Cart struct {
	Lines      []CartLine `json:"lines"`
	ItemCount  int        `json:"item_count"`
	TotalCents int        `json:"total_cents"`
}

var cartLineColumns = `
    ofr.id, i.quantity, coalesce(nullif(i.added_price_cents, 0), ofr.price_cents), ofr.price_cents, ofr.is_active,
    ` + stockOfOffer + `,
    p.slug, p.title, p.cover_url, p.platform, p.region, s.name, s.rating::float8`

var stockOfOffer = catalog.StockOf("ofr.id")

const cartLineJoins = `
JOIN offers ofr ON ofr.id = i.offer_id
JOIN products p ON p.id = ofr.product_id
JOIN sellers s ON s.id = ofr.seller_id`

func (s *Service) Cart(ctx context.Context, userID int64) (Cart, error) {
	return s.queryCart(ctx, `SELECT `+cartLineColumns+` FROM cart_items i`+cartLineJoins+`
		WHERE i.user_id = $1 ORDER BY i.added_at, i.offer_id`, userID)
}

// Quote prices a guest's cart, which lives in the browser, without storing it. Unknown offers are left out.
func (s *Service) Quote(ctx context.Context, items []Item) (Cart, error) {
	items = normalizeItems(items)
	ids := make([]int64, len(items))
	quantities := make([]int, len(items))
	prices := make([]int, len(items))
	for i, it := range items {
		ids[i], quantities[i], prices[i] = it.OfferID, it.Quantity, it.AddedPriceCents
	}
	return s.queryCart(ctx, `SELECT `+cartLineColumns+`
		FROM unnest($1::bigint[], $2::int[], $3::int[]) WITH ORDINALITY AS i (offer_id, quantity, added_price_cents, pos)`+cartLineJoins+`
		ORDER BY i.pos`, ids, quantities, prices)
}

func (s *Service) queryCart(ctx context.Context, sql string, args ...any) (Cart, error) {
	rows, _ := s.db.Query(ctx, sql, args...)
	lines, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (CartLine, error) {
		var l CartLine
		err := row.Scan(&l.OfferID, &l.Quantity, &l.AddedPriceCents, &l.PriceCents, &l.Available, &l.Stock,
			&l.Product.Slug, &l.Product.Title, &l.Product.CoverURL, &l.Product.Platform, &l.Product.Region,
			&l.Seller.Name, &l.Seller.Rating)
		l.LineTotalCents = l.PriceCents * l.Quantity
		return l, err
	})
	if err != nil {
		return Cart{}, fmt.Errorf("load cart: %w", err)
	}
	c := Cart{Lines: lines}
	for _, l := range lines {
		c.ItemCount += l.Quantity
		if l.Available {
			c.TotalCents += l.LineTotalCents
		}
	}
	return c, nil
}

// AddItem adds quantity keys of an offer, on top of any already in the cart.
func (s *Service) AddItem(ctx context.Context, userID, offerID int64, quantity int) (Cart, error) {
	err := s.inUserTx(ctx, userID, func(tx pgx.Tx) error {
		var active bool
		var stock, current, lines int
		err := tx.QueryRow(ctx, `
			SELECT ofr.is_active, `+stockOfOffer+`,
			       coalesce((SELECT quantity FROM cart_items WHERE user_id = $1 AND offer_id = ofr.id), 0),
			       (SELECT count(*)::int FROM cart_items WHERE user_id = $1)
			FROM offers ofr WHERE ofr.id = $2`, userID, offerID).Scan(&active, &stock, &current, &lines)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !active) {
			return ErrOfferUnavailable
		}
		if err != nil {
			return err
		}
		switch want := current + quantity; {
		case current == 0 && lines >= MaxCartLines:
			return ErrCartFull
		case want > MaxQuantity:
			return ErrQuantityLimit
		case want > stock:
			return &StockError{Problems: []StockProblem{{OfferID: offerID, Available: stock}}}
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO cart_items (user_id, offer_id, quantity, added_price_cents)
			SELECT $1, id, $3, price_cents FROM offers WHERE id = $2
			ON CONFLICT (user_id, offer_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`,
			userID, offerID, quantity)
		return err
	})
	if err != nil {
		return Cart{}, err
	}
	return s.Cart(ctx, userID)
}

// SetQuantity changes a line's quantity. It may lower a line that is above the current stock.
func (s *Service) SetQuantity(ctx context.Context, userID, offerID int64, quantity int) (Cart, error) {
	err := s.inUserTx(ctx, userID, func(tx pgx.Tx) error {
		var current, stock int
		err := tx.QueryRow(ctx, `
			SELECT i.quantity, `+catalog.StockOf("i.offer_id")+`
			FROM cart_items i WHERE i.user_id = $1 AND i.offer_id = $2`, userID, offerID).Scan(&current, &stock)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if quantity > current && quantity > stock {
			return &StockError{Problems: []StockProblem{{OfferID: offerID, Available: stock}}}
		}
		_, err = tx.Exec(ctx, `UPDATE cart_items SET quantity = $3 WHERE user_id = $1 AND offer_id = $2`, userID, offerID, quantity)
		return err
	})
	if err != nil {
		return Cart{}, err
	}
	return s.Cart(ctx, userID)
}

func (s *Service) RemoveItem(ctx context.Context, userID, offerID int64) (Cart, error) {
	if _, err := s.db.Exec(ctx, `DELETE FROM cart_items WHERE user_id = $1 AND offer_id = $2`, userID, offerID); err != nil {
		return Cart{}, fmt.Errorf("remove cart item: %w", err)
	}
	return s.Cart(ctx, userID)
}

// Merge moves a guest's cart into the account at sign-in. Quantities add up, capped at MaxQuantity;
// unknown or inactive offers and lines beyond MaxCartLines are dropped. Stock is not checked here:
// the cart shows lines above stock, and checkout refuses them.
func (s *Service) Merge(ctx context.Context, userID int64, items []Item) (Cart, error) {
	items = normalizeItems(items)
	err := s.inUserTx(ctx, userID, func(tx pgx.Tx) error {
		// One round trip; the statements still run in order, so each sees the lines added before it.
		batch := &pgx.Batch{}
		for _, it := range items {
			batch.Queue(`
				INSERT INTO cart_items (user_id, offer_id, quantity, added_price_cents)
				SELECT $1, ofr.id, $3, coalesce(nullif($4, 0), ofr.price_cents)
				FROM offers ofr
				WHERE ofr.id = $2 AND ofr.is_active
				  AND (EXISTS (SELECT 1 FROM cart_items WHERE user_id = $1 AND offer_id = $2)
				       OR (SELECT count(*) FROM cart_items WHERE user_id = $1) < $5)
				ON CONFLICT (user_id, offer_id) DO UPDATE SET quantity = least(cart_items.quantity + EXCLUDED.quantity, $6)`,
				userID, it.OfferID, it.Quantity, it.AddedPriceCents, MaxCartLines, MaxQuantity)
		}
		return tx.SendBatch(ctx, batch).Close()
	})
	if err != nil {
		return Cart{}, fmt.Errorf("merge cart: %w", err)
	}
	return s.Cart(ctx, userID)
}

// normalizeItems merges duplicate offers, drops non-positive quantities, caps each line at MaxQuantity,
// and keeps at most MaxCartLines lines.
func normalizeItems(items []Item) []Item {
	var out []Item
	index := map[int64]int{}
	for _, it := range items {
		if it.OfferID <= 0 || it.Quantity <= 0 {
			continue
		}
		if i, ok := index[it.OfferID]; ok {
			out[i].Quantity = min(out[i].Quantity+it.Quantity, MaxQuantity)
			continue
		}
		if len(out) == MaxCartLines {
			continue
		}
		index[it.OfferID] = len(out)
		it.Quantity = min(it.Quantity, MaxQuantity)
		// The browser supplies this value; anything implausible means "unknown" (current price).
		if it.AddedPriceCents < 0 || it.AddedPriceCents > maxAddedPriceCents {
			it.AddedPriceCents = 0
		}
		out = append(out, it)
	}
	return out
}

// inUserTx runs fn in a transaction holding the user's row lock, which serializes cart changes and
// checkouts for one user (double clicks, several open tabs).
func (s *Service) inUserTx(ctx context.Context, userID int64, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, userID); err != nil {
			return fmt.Errorf("lock user: %w", err)
		}
		return fn(tx)
	})
}
