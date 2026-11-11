package homepage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"eneba-marketplace/backend/internal/catalog"
)

const (
	TypeHero     = "hero_carousel"
	TypeCarousel = "product_carousel"
	TypeDeal     = "deal"

	defaultCarouselLimit = 12
	maxCarouselLimit     = 24
	defaultHeroInterval  = 6000
)

// errSkipBlock marks a block that cannot be shown (bad config, no products).
// It is logged and left out so one broken block never takes down the whole page.
var errSkipBlock = errors.New("skip block")

type Page struct {
	ServerTime time.Time `json:"server_time"`
	Blocks     []Block   `json:"blocks"`
}

type Block struct {
	ID       int64  `json:"id"`
	Type     string `json:"type"`
	Title    string `json:"title"`
	Position int    `json:"position"`
	Data     any    `json:"data"`
}

type HeroSlide struct {
	Title    string               `json:"title"`
	Subtitle string               `json:"subtitle,omitempty"`
	ImageURL string               `json:"image_url"`
	CTALabel string               `json:"cta_label"`
	CTAHref  string               `json:"cta_href"`
	Product  *catalog.ProductCard `json:"product,omitempty"`
}

type HeroData struct {
	IntervalMS int         `json:"interval_ms"`
	Slides     []HeroSlide `json:"slides"`
}

type CarouselData struct {
	Products []catalog.ProductCard `json:"products"`
}

type DealData struct {
	Product catalog.ProductCard `json:"product"`
	EndsAt  time.Time           `json:"ends_at"`
}

type heroConfig struct {
	IntervalMS int `json:"interval_ms"`
	Slides     []struct {
		ProductSlug string `json:"product_slug"`
		Title       string `json:"title"`
		Subtitle    string `json:"subtitle"`
		ImageURL    string `json:"image_url"`
		CTALabel    string `json:"cta_label"`
		CTAHref     string `json:"cta_href"`
	} `json:"slides"`
}

type carouselConfig struct {
	Source       string   `json:"source"`
	ProductSlugs []string `json:"product_slugs"`
	Limit        int      `json:"limit"`
}

type dealConfig struct {
	Rotation     string   `json:"rotation"`
	ProductSlugs []string `json:"product_slugs"`
}

type blockRow struct {
	ID       int64
	Type     string
	Title    string
	Position int
	Config   []byte
	EndsAt   *time.Time
}

type Service struct {
	db      *pgxpool.Pool
	catalog *catalog.Store
}

func NewService(db *pgxpool.Pool, c *catalog.Store) *Service {
	return &Service{db: db, catalog: c}
}

func (s *Service) Page(ctx context.Context, now time.Time) (Page, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, block_type, title, position, config, ends_at
		FROM homepage_blocks
		WHERE is_active
		  AND (starts_at IS NULL OR starts_at <= $1)
		  AND (ends_at IS NULL OR ends_at > $1)
		ORDER BY position, id`, now)
	if err != nil {
		return Page{}, fmt.Errorf("query blocks: %w", err)
	}
	blockRows, err := pgx.CollectRows(rows, pgx.RowToStructByPos[blockRow])
	if err != nil {
		return Page{}, fmt.Errorf("scan blocks: %w", err)
	}

	page := Page{ServerTime: now, Blocks: []Block{}}
	for _, r := range blockRows {
		data, err := s.resolve(ctx, r, now)
		if errors.Is(err, errSkipBlock) {
			slog.Warn("homepage block skipped", "id", r.ID, "type", r.Type, "reason", err)
			continue
		}
		if err != nil {
			return Page{}, err
		}
		page.Blocks = append(page.Blocks, Block{ID: r.ID, Type: r.Type, Title: r.Title, Position: r.Position, Data: data})
	}
	return page, nil
}

func (s *Service) resolve(ctx context.Context, r blockRow, now time.Time) (any, error) {
	switch r.Type {
	case TypeHero:
		return s.resolveHero(ctx, r.Config)
	case TypeCarousel:
		return s.resolveCarousel(ctx, r.Config)
	case TypeDeal:
		return s.resolveDeal(ctx, r.Config, r.EndsAt, now)
	default:
		return nil, fmt.Errorf("%w: unknown type", errSkipBlock)
	}
}

func decode(raw []byte, v any) error {
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("%w: invalid config: %v", errSkipBlock, err)
	}
	return nil
}

func (s *Service) resolveHero(ctx context.Context, raw []byte) (any, error) {
	var cfg heroConfig
	if err := decode(raw, &cfg); err != nil {
		return nil, err
	}
	slugs := make([]string, 0, len(cfg.Slides))
	for _, sl := range cfg.Slides {
		if sl.ProductSlug != "" {
			slugs = append(slugs, sl.ProductSlug)
		}
	}
	cards, err := s.cardsBySlug(ctx, slugs)
	if err != nil {
		return nil, err
	}

	data := HeroData{IntervalMS: cfg.IntervalMS, Slides: []HeroSlide{}}
	if data.IntervalMS <= 0 {
		data.IntervalMS = defaultHeroInterval
	}
	for _, sl := range cfg.Slides {
		slide := HeroSlide{Title: sl.Title, Subtitle: sl.Subtitle, ImageURL: sl.ImageURL, CTALabel: sl.CTALabel, CTAHref: sl.CTAHref}
		if card, ok := cards[sl.ProductSlug]; ok {
			slide.Product = &card
			if slide.ImageURL == "" {
				slide.ImageURL = card.BannerURL
			}
			if slide.CTAHref == "" {
				slide.CTAHref = "/product/" + card.Slug
			}
			if slide.Title == "" {
				slide.Title = card.Title
			}
		}
		if slide.ImageURL == "" || slide.CTAHref == "" || slide.Title == "" {
			continue
		}
		if slide.CTALabel == "" {
			slide.CTALabel = "Shop now"
		}
		data.Slides = append(data.Slides, slide)
	}
	if len(data.Slides) == 0 {
		return nil, fmt.Errorf("%w: no usable slides", errSkipBlock)
	}
	return data, nil
}

func (s *Service) resolveCarousel(ctx context.Context, raw []byte) (any, error) {
	var cfg carouselConfig
	if err := decode(raw, &cfg); err != nil {
		return nil, err
	}
	limit := cfg.Limit
	if limit <= 0 {
		limit = defaultCarouselLimit
	}
	limit = min(limit, maxCarouselLimit)

	var products []catalog.ProductCard
	var err error
	switch cfg.Source {
	case "manual":
		slugs := cfg.ProductSlugs[:min(len(cfg.ProductSlugs), limit)]
		products, err = s.catalog.CardsBySlugs(ctx, slugs)
	case string(catalog.SortBestSelling), string(catalog.SortNewest), string(catalog.SortDiscount):
		products, err = s.catalog.ListCards(ctx, catalog.Sort(cfg.Source), limit)
	default:
		return nil, fmt.Errorf("%w: unknown source %q", errSkipBlock, cfg.Source)
	}
	if err != nil {
		return nil, err
	}
	if len(products) == 0 {
		return nil, fmt.Errorf("%w: no products", errSkipBlock)
	}
	return CarouselData{Products: products}, nil
}

func (s *Service) resolveDeal(ctx context.Context, raw []byte, blockEndsAt *time.Time, now time.Time) (any, error) {
	var cfg dealConfig
	if err := decode(raw, &cfg); err != nil {
		return nil, err
	}
	if cfg.Rotation != "daily" || len(cfg.ProductSlugs) == 0 {
		return nil, fmt.Errorf("%w: deal needs daily rotation and products", errSkipBlock)
	}
	cards, err := s.cardsBySlug(ctx, cfg.ProductSlugs)
	if err != nil {
		return nil, err
	}

	start, endsAt := dailySlot(len(cfg.ProductSlugs), now)
	if blockEndsAt != nil && blockEndsAt.Before(endsAt) {
		endsAt = *blockEndsAt
	}
	// Today's pick may have sold out; fall through to the next product in the rotation.
	for i := range cfg.ProductSlugs {
		if card, ok := cards[cfg.ProductSlugs[(start+i)%len(cfg.ProductSlugs)]]; ok {
			return DealData{Product: card, EndsAt: endsAt}, nil
		}
	}
	return nil, fmt.Errorf("%w: no purchasable deal product", errSkipBlock)
}

// dailySlot picks the rotation index for the current UTC day and when that day ends.
func dailySlot(n int, now time.Time) (int, time.Time) {
	day := now.UTC().Truncate(24 * time.Hour)
	return int(day.Unix()/86400) % n, day.Add(24 * time.Hour)
}

func (s *Service) cardsBySlug(ctx context.Context, slugs []string) (map[string]catalog.ProductCard, error) {
	cards, err := s.catalog.CardsBySlugs(ctx, slugs)
	if err != nil {
		return nil, err
	}
	m := make(map[string]catalog.ProductCard, len(cards))
	for _, c := range cards {
		m[c.Slug] = c
	}
	return m, nil
}
