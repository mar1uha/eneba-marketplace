package catalog

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
)

// Platforms and Regions list every allowed value in display order, matching the CHECK constraints on products.
var (
	Platforms = []string{"steam", "xbox", "playstation", "nintendo", "ea_app", "ubisoft_connect", "gog", "epic"}
	Regions   = []string{"global", "europe", "north_america", "united_kingdom"}
)

type SearchSort string

const (
	SearchByRelevance   SearchSort = "relevance"
	SearchByBestSelling SearchSort = "best_selling"
	SearchByPriceAsc    SearchSort = "price_asc"
	SearchByPriceDesc   SearchSort = "price_desc"
)

var searchOrder = map[SearchSort]string{
	SearchByRelevance:   "b.rank DESC, b.sold_count DESC, b.id",
	SearchByBestSelling: "b.sold_count DESC, b.id",
	SearchByPriceAsc:    "b.price_cents, b.sold_count DESC, b.id",
	SearchByPriceDesc:   "b.price_cents DESC, b.sold_count DESC, b.id",
}

// SearchQuery filters with OR inside a dimension (Steam or Xbox) and AND across dimensions (Steam and RPG).
type SearchQuery struct {
	Text      string
	Platforms []string
	Regions   []string
	Genres    []string
	// Price bounds apply to the cheapest active offer, inclusive. Zero means no bound.
	MinPriceCents int
	MaxPriceCents int
	// An empty Sort means relevance when there is search text and best selling otherwise.
	Sort     SearchSort
	Page     int
	PageSize int
}

type SearchResult struct {
	Items    []ProductCard `json:"items"`
	Total    int           `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"page_size"`
	Sort     SearchSort    `json:"sort"`
	Facets   *Facets       `json:"facets,omitempty"`
	// DidYouMean is the closest title when the search text matches nothing at all, even without filters.
	DidYouMean string `json:"did_you_mean,omitempty"`
}

// Facets count matches per option. Each dimension ignores its own selection, so choosing Steam
// still shows how many results Xbox would add.
type Facets struct {
	Platforms []FacetCount `json:"platforms"`
	Regions   []FacetCount `json:"regions"`
	Genres    []FacetCount `json:"genres"`
	// Price is the cheapest-offer range of the results before the price filter; nil when nothing matches.
	Price *PriceRange `json:"price"`
}

type FacetCount struct {
	Value string `json:"value"`
	Label string `json:"label,omitempty"`
	Count int    `json:"count"`
}

type PriceRange struct {
	MinCents int `json:"min_cents"`
	MaxCents int `json:"max_cents"`
}

type dimension int

const (
	noDimension dimension = iota
	dimPlatform
	dimRegion
	dimGenre
	dimPrice
)

type filter struct {
	dim dimension
	sql string
}

// Text matching: every token of the normalized query must match a word of the product's search_text,
// either as a word prefix or within a small edit distance (see searchTextCTE). The whole query with
// spaces removed may also appear in the title with spaces removed ("cyber punk" finds "Cyberpunk").
// Rank: exact title > title prefix > word-prefix phrase > fuzzy, then trigram similarity.
const searchTextCTE = `
WITH search AS (
    SELECT search_normalize(@q) AS text
),
search_tokens AS (
    SELECT DISTINCT token,
           CASE WHEN length(token) >= 7 THEN 2 WHEN length(token) >= 4 THEN 1 ELSE 0 END AS typos
    FROM search, unnest(string_to_array(search.text, ' ')) AS token
),
token_hits AS (
    SELECT p.id, count(DISTINCT t.token) AS hits
    FROM products p
    CROSS JOIN LATERAL unnest(string_to_array(p.search_text, ' ')) AS w (word)
    JOIN search_tokens t
      ON starts_with(w.word, t.token)
      OR (t.typos > 0 AND left(w.word, 1) = left(t.token, 1)
          AND (levenshtein_less_equal(t.token, w.word, t.typos) <= t.typos
               OR (length(t.token) >= 6 AND levenshtein_less_equal(t.token, left(w.word, length(t.token)), 1) <= 1)))
      OR (length(t.token) >= 5 AND strpos(replace(p.search_text, ' ', ''), t.token) > 0)
    GROUP BY p.id
),
base AS (
    SELECT p.id, p.slug, p.title, p.cover_url, p.banner_url, p.platform, p.region, p.product_type,
           p.msrp_cents, o.price_cents, o.offer_count, p.sold_count,
           CASE
               WHEN p.search_text = search.text THEN 4
               WHEN starts_with(p.search_text, search.text) THEN 3
               WHEN strpos(' ' || p.search_text, ' ' || search.text) > 0 THEN 2
               ELSE 0
           END + word_similarity(search.text, p.search_text) AS rank
    FROM products p` + cheapestOffer + `
    CROSS JOIN search
    LEFT JOIN token_hits th ON th.id = p.id
    WHERE th.hits = (SELECT count(*) FROM search_tokens)
       OR (length(replace(search.text, ' ', '')) >= 5
           AND strpos(replace(p.search_text, ' ', ''), replace(search.text, ' ', '')) > 0)
)`

const browseCTE = `
WITH base AS (
    SELECT p.id, p.slug, p.title, p.cover_url, p.banner_url, p.platform, p.region, p.product_type,
           p.msrp_cents, o.price_cents, o.offer_count, p.sold_count, 0::float8 AS rank
    FROM products p` + cheapestOffer + `
)`

// didYouMeanSQL suggests the product matching the most query tokens (at least half), but only when the
// text matches nothing even without filters; otherwise the filters are what hide the results.
const didYouMeanSQL = searchTextCTE + `
SELECT p.title
FROM products p
JOIN token_hits th ON th.id = p.id
CROSS JOIN search
WHERE NOT EXISTS (SELECT 1 FROM base)
  AND EXISTS (SELECT 1 FROM offers ofr WHERE ofr.product_id = p.id AND ` + purchasable + `)
  AND th.hits * 2 >= (SELECT count(*) FROM search_tokens)
ORDER BY th.hits DESC, word_similarity(search.text, p.search_text) DESC, p.sold_count DESC, p.id
LIMIT 1`

// HasSearchText reports whether text contains anything searchable; punctuation alone is not.
func HasSearchText(text string) bool {
	return strings.IndexFunc(text, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) >= 0
}

// Search returns one page of matching product cards. Facet counts are computed only when withFacets is set.
func (s *Store) Search(ctx context.Context, q SearchQuery, withFacets bool) (SearchResult, error) {
	hasText := HasSearchText(q.Text)
	sort := q.Sort
	if sort == "" || (sort == SearchByRelevance && !hasText) {
		sort = SearchByBestSelling
		if hasText {
			sort = SearchByRelevance
		}
	}
	order, ok := searchOrder[sort]
	if !ok {
		return SearchResult{}, fmt.Errorf("unknown search sort %q", sort)
	}
	if q.Page < 1 || q.PageSize < 1 {
		return SearchResult{}, errors.New("page and page size must be positive")
	}

	prefix := browseCTE
	if hasText {
		prefix = searchTextCTE
	}
	args := pgx.NamedArgs{
		"q":         q.Text,
		"platforms": q.Platforms,
		"regions":   q.Regions,
		"genres":    q.Genres,
		"min_price": q.MinPriceCents,
		"max_price": q.MaxPriceCents,
		"limit":     q.PageSize,
		"offset":    (q.Page - 1) * q.PageSize,
	}
	filters := q.filters()

	batch := &pgx.Batch{}
	batch.Queue(prefix+`
SELECT b.id, b.slug, b.title, b.cover_url, b.banner_url, b.platform, b.region, b.product_type,
       b.msrp_cents, b.price_cents, b.offer_count
FROM base b`+where(filters, noDimension)+`
ORDER BY `+order+`
LIMIT @limit OFFSET @offset`, args)
	batch.Queue(prefix+`SELECT count(*)::int FROM base b`+where(filters, noDimension), args)
	if withFacets {
		batch.Queue(prefix+`SELECT b.platform, count(*)::int FROM base b`+where(filters, dimPlatform)+` GROUP BY b.platform`, args)
		batch.Queue(prefix+`SELECT b.region, count(*)::int FROM base b`+where(filters, dimRegion)+` GROUP BY b.region`, args)
		batch.Queue(prefix+`
SELECT g.slug, g.name, count(b.id)::int
FROM genres g
LEFT JOIN product_genres pg ON pg.genre_id = g.id
LEFT JOIN (SELECT b.id FROM base b`+where(filters, dimGenre)+`) b ON b.id = pg.product_id
GROUP BY g.id
ORDER BY g.name`, args)
		batch.Queue(prefix+`SELECT min(b.price_cents), max(b.price_cents) FROM base b`+where(filters, dimPrice), args)
	}

	res := SearchResult{Page: q.Page, PageSize: q.PageSize, Sort: sort}
	if err := s.readSearchBatch(ctx, batch, withFacets, &res); err != nil {
		return SearchResult{}, err
	}

	if res.Total == 0 && hasText {
		var title string
		err := s.db.QueryRow(ctx, didYouMeanSQL, args).Scan(&title)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
		case err != nil:
			return SearchResult{}, fmt.Errorf("find did-you-mean title: %w", err)
		default:
			res.DidYouMean = title
		}
	}
	return res, nil
}

func (s *Store) readSearchBatch(ctx context.Context, batch *pgx.Batch, withFacets bool, res *SearchResult) error {
	br := s.db.SendBatch(ctx, batch)
	defer br.Close()

	rows, err := br.Query()
	if err != nil {
		return fmt.Errorf("query search results: %w", err)
	}
	if res.Items, err = collectCards(rows); err != nil {
		return fmt.Errorf("scan search results: %w", err)
	}
	if err := br.QueryRow().Scan(&res.Total); err != nil {
		return fmt.Errorf("count search results: %w", err)
	}
	if !withFacets {
		return nil
	}

	f := &Facets{}
	if f.Platforms, err = readFacet(br, Platforms); err != nil {
		return fmt.Errorf("count platforms: %w", err)
	}
	if f.Regions, err = readFacet(br, Regions); err != nil {
		return fmt.Errorf("count regions: %w", err)
	}
	rows, err = br.Query()
	if err != nil {
		return fmt.Errorf("count genres: %w", err)
	}
	f.Genres, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (FacetCount, error) {
		var c FacetCount
		return c, row.Scan(&c.Value, &c.Label, &c.Count)
	})
	if err != nil {
		return fmt.Errorf("count genres: %w", err)
	}
	var minCents, maxCents *int
	if err := br.QueryRow().Scan(&minCents, &maxCents); err != nil {
		return fmt.Errorf("price range: %w", err)
	}
	if minCents != nil && maxCents != nil {
		f.Price = &PriceRange{MinCents: *minCents, MaxCents: *maxCents}
	}
	res.Facets = f
	return nil
}

// readFacet returns a count for every allowed value, in display order, including zeros.
func readFacet(br pgx.BatchResults, values []string) ([]FacetCount, error) {
	rows, err := br.Query()
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	var value string
	var count int
	if _, err := pgx.ForEachRow(rows, []any{&value, &count}, func() error {
		counts[value] = count
		return nil
	}); err != nil {
		return nil, err
	}
	out := make([]FacetCount, len(values))
	for i, v := range values {
		out[i] = FacetCount{Value: v, Count: counts[v]}
	}
	return out, nil
}

func (q SearchQuery) filters() []filter {
	var fs []filter
	if len(q.Platforms) > 0 {
		fs = append(fs, filter{dimPlatform, "b.platform = ANY(@platforms)"})
	}
	if len(q.Regions) > 0 {
		fs = append(fs, filter{dimRegion, "b.region = ANY(@regions)"})
	}
	if len(q.Genres) > 0 {
		fs = append(fs, filter{dimGenre, `EXISTS (
    SELECT 1 FROM product_genres pg JOIN genres g ON g.id = pg.genre_id
    WHERE pg.product_id = b.id AND g.slug = ANY(@genres))`})
	}
	if q.MinPriceCents > 0 {
		fs = append(fs, filter{dimPrice, "b.price_cents >= @min_price"})
	}
	if q.MaxPriceCents > 0 {
		fs = append(fs, filter{dimPrice, "b.price_cents <= @max_price"})
	}
	return fs
}

// where joins every filter except those of the excluded dimension.
func where(fs []filter, except dimension) string {
	var parts []string
	for _, f := range fs {
		if f.dim != except {
			parts = append(parts, f.sql)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return "\nWHERE " + strings.Join(parts, "\n  AND ")
}
