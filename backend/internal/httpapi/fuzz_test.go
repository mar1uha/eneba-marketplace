package httpapi

import (
	"net/url"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"eneba-marketplace/backend/internal/catalog"
)

// FuzzParseSearchQuery feeds arbitrary query strings to the Store's parameter parser. Whatever it
// accepts must be safe to hand to SQL: bounded, valid UTF-8 without NUL, and only known values.
// Run longer with: go test ./internal/httpapi -run '^$' -fuzz FuzzParseSearchQuery -fuzztime 30s
func FuzzParseSearchQuery(f *testing.F) {
	for _, seed := range []string{
		"", "q=witcher&platform=steam,gog&genre=rpg&min_price_cents=500&max_price_cents=2000&sort=price_asc&page=2&page_size=12",
		"q=%00", "q=a%ff", "platform=ps5", "page=0", "page=1001", "min_price_cents=9&max_price_cents=1",
		"genre=a,b,c,a,,", "q=" + strings.Repeat("😀", 101), "sort=relevance&q=+++",
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		v, err := url.ParseQuery(raw)
		if err != nil {
			return
		}
		q, err := parseSearchQuery(v)
		if err != nil {
			return
		}
		if !utf8.ValidString(q.Text) || strings.ContainsRune(q.Text, 0) || utf8.RuneCountInString(q.Text) > maxSearchLength {
			t.Fatalf("unsafe search text accepted: %q", q.Text)
		}
		if q.Page < 1 || q.Page > maxPage || q.PageSize < 1 || q.PageSize > maxPageSize {
			t.Fatalf("page out of bounds: %d/%d", q.Page, q.PageSize)
		}
		if q.MinPriceCents < 0 || q.MaxPriceCents < 0 || q.MinPriceCents > maxPriceCents || q.MaxPriceCents > maxPriceCents ||
			(q.MinPriceCents > 0 && q.MaxPriceCents > 0 && q.MinPriceCents > q.MaxPriceCents) {
			t.Fatalf("bad price range: %d..%d", q.MinPriceCents, q.MaxPriceCents)
		}
		check := func(name string, values []string, valid func(string) bool) {
			if len(values) > maxFilterValues {
				t.Fatalf("%d %s values accepted", len(values), name)
			}
			for i, s := range values {
				if !valid(s) || slices.Contains(values[:i], s) {
					t.Fatalf("%s value %q accepted (invalid or duplicate)", name, s)
				}
			}
		}
		check("platform", q.Platforms, func(s string) bool { return slices.Contains(catalog.Platforms, s) })
		check("region", q.Regions, func(s string) bool { return slices.Contains(catalog.Regions, s) })
		check("genre", q.Genres, slugPattern.MatchString)
		switch q.Sort {
		case "", catalog.SearchByRelevance, catalog.SearchByBestSelling, catalog.SearchByPriceAsc, catalog.SearchByPriceDesc:
		default:
			t.Fatalf("unknown sort accepted: %q", q.Sort)
		}
	})
}
