package catalog

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

var ErrProductNotFound = errors.New("product not found")

type ProductDetail struct {
	ID          int64   `json:"id"`
	Slug        string  `json:"slug"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	CoverURL    string  `json:"cover_url"`
	BannerURL   string  `json:"banner_url"`
	Platform    string  `json:"platform"`
	Region      string  `json:"region"`
	ProductType string  `json:"product_type"`
	MSRPCents   int     `json:"msrp_cents"`
	ReleaseDate *string `json:"release_date"`
	Genres      []Genre `json:"genres"`
	// Editions lists every platform/region edition of the same game, this one included.
	Editions []Edition `json:"editions"`
	// Offers are the active offers: in stock first, cheapest first; sold-out offers last.
	Offers []Offer `json:"offers"`
}

type Genre struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type Edition struct {
	Slug     string `json:"slug"`
	Title    string `json:"title"`
	Platform string `json:"platform"`
	Region   string `json:"region"`
	// PriceCents is the cheapest purchasable offer; nil when the edition has nothing to buy.
	PriceCents *int `json:"price_cents"`
	Current    bool `json:"current"`
}

type Offer struct {
	ID              int64  `json:"id"`
	PriceCents      int    `json:"price_cents"`
	DiscountPercent int    `json:"discount_percent"`
	Stock           int    `json:"stock"`
	Seller          Seller `json:"seller"`
}

type Seller struct {
	Name        string  `json:"name"`
	Rating      float64 `json:"rating"`
	ReviewCount int     `json:"review_count"`
}

// Product loads a product page in one round trip; every query is keyed by the slug.
func (s *Store) Product(ctx context.Context, slug string) (ProductDetail, error) {
	batch := &pgx.Batch{}
	batch.Queue(`
		SELECT id, slug, title, description, cover_url, banner_url, platform, region, product_type, msrp_cents,
		       to_char(release_date, 'YYYY-MM-DD')
		FROM products WHERE slug = $1`, slug)
	batch.Queue(`
		SELECT g.slug, g.name
		FROM products p JOIN product_genres pg ON pg.product_id = p.id JOIN genres g ON g.id = pg.genre_id
		WHERE p.slug = $1 ORDER BY g.name`, slug)
	batch.Queue(`
		SELECT p.slug, p.title, p.platform, p.region, o.price_cents, p.slug = $1
		FROM products p
		LEFT JOIN LATERAL (
		    SELECT min(ofr.price_cents)::int AS price_cents FROM offers ofr
		    WHERE ofr.product_id = p.id AND `+purchasable+`
		) o ON true
		WHERE coalesce(p.edition_of, p.id) = (SELECT coalesce(edition_of, id) FROM products WHERE slug = $1)
		ORDER BY array_position($2::text[], p.platform), array_position($3::text[], p.region), p.id`,
		slug, Platforms, Regions)
	batch.Queue(`
		SELECT id, price_cents, stock, name, rating, review_count FROM (
		    SELECT ofr.id, ofr.price_cents, s.name, s.rating::float8 AS rating, s.review_count, `+StockOf("ofr.id")+` AS stock
		    FROM products p JOIN offers ofr ON ofr.product_id = p.id JOIN sellers s ON s.id = ofr.seller_id
		    WHERE p.slug = $1 AND ofr.is_active
		) x
		ORDER BY stock = 0, price_cents, rating DESC, id`, slug)

	br := s.db.SendBatch(ctx, batch)
	defer br.Close()

	var p ProductDetail
	err := br.QueryRow().Scan(&p.ID, &p.Slug, &p.Title, &p.Description, &p.CoverURL, &p.BannerURL, &p.Platform,
		&p.Region, &p.ProductType, &p.MSRPCents, &p.ReleaseDate)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrProductNotFound
	}
	if err != nil {
		return p, fmt.Errorf("load product: %w", err)
	}

	rows, _ := br.Query()
	if p.Genres, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Genre, error) {
		var g Genre
		return g, row.Scan(&g.Slug, &g.Name)
	}); err != nil {
		return p, fmt.Errorf("load genres: %w", err)
	}
	rows, _ = br.Query()
	if p.Editions, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Edition, error) {
		var e Edition
		return e, row.Scan(&e.Slug, &e.Title, &e.Platform, &e.Region, &e.PriceCents, &e.Current)
	}); err != nil {
		return p, fmt.Errorf("load editions: %w", err)
	}
	rows, _ = br.Query()
	if p.Offers, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Offer, error) {
		var o Offer
		err := row.Scan(&o.ID, &o.PriceCents, &o.Stock, &o.Seller.Name, &o.Seller.Rating, &o.Seller.ReviewCount)
		o.DiscountPercent = discountPercent(p.MSRPCents, o.PriceCents)
		return o, err
	}); err != nil {
		return p, fmt.Errorf("load offers: %w", err)
	}
	return p, nil
}
