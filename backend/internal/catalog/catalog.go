package catalog

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProductCard is the summary shown in product grids: the product plus its cheapest active offer.
type ProductCard struct {
	ID              int64  `json:"id"`
	Slug            string `json:"slug"`
	Title           string `json:"title"`
	CoverURL        string `json:"cover_url"`
	BannerURL       string `json:"banner_url"`
	Platform        string `json:"platform"`
	Region          string `json:"region"`
	ProductType     string `json:"product_type"`
	MSRPCents       int    `json:"msrp_cents"`
	PriceCents      int    `json:"price_cents"`
	DiscountPercent int    `json:"discount_percent"`
	OfferCount      int    `json:"offer_count"`
}

type Sort string

const (
	SortBestSelling Sort = "best_selling"
	SortNewest      Sort = "newest"
	SortDiscount    Sort = "discount"
)

// KeyForSale matches digital_keys rows (alias k) that can be sold: available, or held by a checkout
// whose reservation has run out.
const KeyForSale = `(k.status = 'available' OR (k.status = 'reserved' AND k.reserved_until < now()))`

// StockOf is SQL for the number of keys for sale for the offer whose id is the column offerCol.
func StockOf(offerCol string) string {
	return `(SELECT count(*)::int FROM digital_keys k WHERE k.offer_id = ` + offerCol + ` AND ` + KeyForSale + `)`
}

// purchasable matches offers (alias ofr) that can be bought now: active and with a key for sale.
const purchasable = `ofr.is_active AND EXISTS (SELECT 1 FROM digital_keys k WHERE k.offer_id = ofr.id AND ` + KeyForSale + `)`

// cheapestOffer joins products (alias p) to their purchasable offers as o.price_cents (cheapest) and
// o.offer_count. Products with nothing to buy are dropped.
const cheapestOffer = `
JOIN LATERAL (
    SELECT min(ofr.price_cents)::int AS price_cents, count(*)::int AS offer_count
    FROM offers ofr
    WHERE ofr.product_id = p.id AND ` + purchasable + `
) o ON o.offer_count > 0`

const cardSelect = `
SELECT p.id, p.slug, p.title, p.cover_url, p.banner_url, p.platform, p.region, p.product_type,
       p.msrp_cents, o.price_cents, o.offer_count
FROM products p` + cheapestOffer

var sortClauses = map[Sort]struct{ where, orderBy string }{
	SortBestSelling: {"", "p.sold_count DESC, p.id"},
	SortNewest:      {"WHERE p.release_date <= CURRENT_DATE", "p.release_date DESC, p.id"},
	SortDiscount:    {"", "(p.msrp_cents - o.price_cents)::float8 / p.msrp_cents DESC, p.id"},
}

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) ListCards(ctx context.Context, sort Sort, limit int) ([]ProductCard, error) {
	c, ok := sortClauses[sort]
	if !ok {
		return nil, fmt.Errorf("unknown sort %q", sort)
	}
	q := cardSelect + " " + c.where + " ORDER BY " + c.orderBy + " LIMIT $1"
	return s.queryCards(ctx, q, limit)
}

// CardsBySlugs returns cards in the order of slugs, skipping unknown or unpurchasable products.
func (s *Store) CardsBySlugs(ctx context.Context, slugs []string) ([]ProductCard, error) {
	if len(slugs) == 0 {
		return []ProductCard{}, nil
	}
	q := cardSelect + " WHERE p.slug = ANY($1) ORDER BY array_position($1::text[], p.slug)"
	return s.queryCards(ctx, q, slugs)
}

func (s *Store) queryCards(ctx context.Context, q string, args ...any) ([]ProductCard, error) {
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("query product cards: %w", err)
	}
	cards, err := collectCards(rows)
	if err != nil {
		return nil, fmt.Errorf("scan product cards: %w", err)
	}
	return cards, nil
}

// collectCards scans rows selected in cardSelect's column order.
func collectCards(rows pgx.Rows) ([]ProductCard, error) {
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ProductCard, error) {
		var c ProductCard
		err := row.Scan(&c.ID, &c.Slug, &c.Title, &c.CoverURL, &c.BannerURL, &c.Platform, &c.Region,
			&c.ProductType, &c.MSRPCents, &c.PriceCents, &c.OfferCount)
		c.DiscountPercent = discountPercent(c.MSRPCents, c.PriceCents)
		return c, err
	})
}

func discountPercent(msrp, price int) int {
	if msrp <= 0 || price >= msrp {
		return 0
	}
	return (msrp - price) * 100 / msrp
}
