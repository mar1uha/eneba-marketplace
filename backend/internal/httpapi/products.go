package httpapi

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"eneba-marketplace/backend/internal/catalog"
)

const (
	defaultPageSize   = 24
	maxPageSize       = 48
	maxPage           = 1000
	maxSearchLength   = 100
	maxFilterValues   = 20
	maxPriceCents     = 1_000_000
	suggestionsToShow = 6
)

// slugPattern matches product and genre slugs, as the database CHECK constraints define them.
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// listProducts serves the Store: GET /api/products?q=&platform=steam,xbox&region=&genre=
// &min_price_cents=&max_price_cents=&sort=&page=&page_size=
func (a *API) listProducts(w http.ResponseWriter, r *http.Request) {
	q, err := parseSearchQuery(r.URL.Query())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	res, err := a.Catalog.Search(r.Context(), q, true)
	if err != nil {
		writeServerError(w, err, "search products", "could not load products")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// searchSuggestions serves the header search box: the best matches for q, without facets.
func (a *API) searchSuggestions(w http.ResponseWriter, r *http.Request) {
	text, err := parseSearchText(r.URL.Query())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !catalog.HasSearchText(text) {
		writeJSON(w, http.StatusOK, catalog.SearchResult{Items: []catalog.ProductCard{}, Page: 1, PageSize: suggestionsToShow, Sort: catalog.SearchByRelevance})
		return
	}
	res, err := a.Catalog.Search(r.Context(), catalog.SearchQuery{Text: text, Page: 1, PageSize: suggestionsToShow}, false)
	if err != nil {
		writeServerError(w, err, "search suggestions", "could not load suggestions")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func parseSearchQuery(v url.Values) (catalog.SearchQuery, error) {
	q := catalog.SearchQuery{Page: 1, PageSize: defaultPageSize}
	var err error
	if q.Text, err = parseSearchText(v); err != nil {
		return q, err
	}
	if q.Platforms, err = parseList(v, "platform", func(s string) bool { return slices.Contains(catalog.Platforms, s) }); err != nil {
		return q, err
	}
	if q.Regions, err = parseList(v, "region", func(s string) bool { return slices.Contains(catalog.Regions, s) }); err != nil {
		return q, err
	}
	if q.Genres, err = parseList(v, "genre", slugPattern.MatchString); err != nil {
		return q, err
	}
	if q.MinPriceCents, err = parseInt(v, "min_price_cents", 0, 1, maxPriceCents); err != nil {
		return q, err
	}
	if q.MaxPriceCents, err = parseInt(v, "max_price_cents", 0, 1, maxPriceCents); err != nil {
		return q, err
	}
	if q.MinPriceCents > 0 && q.MaxPriceCents > 0 && q.MinPriceCents > q.MaxPriceCents {
		return q, fmt.Errorf("min_price_cents must not exceed max_price_cents")
	}
	switch s := catalog.SearchSort(v.Get("sort")); s {
	case "", catalog.SearchByRelevance, catalog.SearchByBestSelling, catalog.SearchByPriceAsc, catalog.SearchByPriceDesc:
		q.Sort = s
	default:
		return q, fmt.Errorf("unknown sort %q", s)
	}
	if q.Page, err = parseInt(v, "page", 1, 1, maxPage); err != nil {
		return q, err
	}
	if q.PageSize, err = parseInt(v, "page_size", defaultPageSize, 1, maxPageSize); err != nil {
		return q, err
	}
	return q, nil
}

func parseSearchText(v url.Values) (string, error) {
	text := strings.TrimSpace(v.Get("q"))
	// PostgreSQL text cannot hold NUL bytes or invalid UTF-8; sending them would fail the query.
	if !utf8.ValidString(text) || strings.ContainsRune(text, 0) {
		return "", fmt.Errorf("search text contains characters that cannot be searched")
	}
	if utf8.RuneCountInString(text) > maxSearchLength {
		return "", fmt.Errorf("search text is too long (%d characters max)", maxSearchLength)
	}
	return text, nil
}

// parseList reads a comma-separated parameter, dropping blanks and duplicates.
func parseList(v url.Values, name string, valid func(string) bool) ([]string, error) {
	raw := v.Get(name)
	if raw == "" {
		return nil, nil
	}
	var out []string
	for _, s := range strings.Split(raw, ",") {
		s = strings.TrimSpace(s)
		if s == "" || slices.Contains(out, s) {
			continue
		}
		if !valid(s) {
			return nil, fmt.Errorf("unknown %s %q", name, s)
		}
		out = append(out, s)
	}
	if len(out) > maxFilterValues {
		return nil, fmt.Errorf("too many %s values (%d max)", name, maxFilterValues)
	}
	return out, nil
}

func parseInt(v url.Values, name string, fallback, lo, hi int) (int, error) {
	raw := v.Get(name)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < lo || n > hi {
		return 0, fmt.Errorf("%s must be a whole number from %d to %d", name, lo, hi)
	}
	return n, nil
}
