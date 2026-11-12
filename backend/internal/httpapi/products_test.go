package httpapi

import (
	"encoding/json"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"eneba-marketplace/backend/internal/catalog"
)

func TestParseSearchQuery(t *testing.T) {
	v, _ := url.ParseQuery("q=+witcher++&platform=steam,,xbox,steam&genre=rpg,co-op&min_price_cents=500&max_price_cents=2000&sort=price_desc&page=3&page_size=12")
	got, err := parseSearchQuery(v)
	if err != nil {
		t.Fatal(err)
	}
	want := catalog.SearchQuery{
		Text: "witcher", Platforms: []string{"steam", "xbox"}, Genres: []string{"rpg", "co-op"},
		MinPriceCents: 500, MaxPriceCents: 2000, Sort: catalog.SearchByPriceDesc, Page: 3, PageSize: 12,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}

	defaults, err := parseSearchQuery(url.Values{})
	if err != nil || defaults.Page != 1 || defaults.PageSize != defaultPageSize || defaults.Sort != "" {
		t.Errorf("defaults: %+v, %v", defaults, err)
	}

	manyGenres := make([]string, maxFilterValues+1)
	for i := range manyGenres {
		manyGenres[i] = "genre-" + string(rune('a'+i))
	}
	for _, bad := range []string{
		"platform=ps5",
		"region=mars",
		"genre=Not_A_Slug",
		"sort=cheapest",
		"page=0",
		"page=abc",
		"page_size=49",
		"min_price_cents=-1",
		"max_price_cents=0",
		"min_price_cents=2000&max_price_cents=1000",
		"q=" + strings.Repeat("a", maxSearchLength+1),
		"genre=" + strings.Join(manyGenres, ","),
	} {
		v, _ := url.ParseQuery(bad)
		if _, err := parseSearchQuery(v); err == nil {
			t.Errorf("%s: expected an error", bad)
		}
	}
}

func getJSON(t *testing.T, env *testEnv, path string, wantStatus int, dst any) {
	t.Helper()
	res, err := http.Get(env.srv.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != wantStatus {
		t.Fatalf("GET %s: status %d, want %d", path, res.StatusCode, wantStatus)
	}
	if err := json.NewDecoder(res.Body).Decode(dst); err != nil {
		t.Fatal(err)
	}
}

func TestProductsEndpoint(t *testing.T) {
	env := newTestEnv(t)

	var res catalog.SearchResult
	getJSON(t, env, "/api/products?q=witcer&platform=gog", http.StatusOK, &res)
	if res.Total != 1 || res.Items[0].Title != "The Witcher 3: Wild Hunt" || res.Items[0].Platform != "gog" {
		t.Errorf("unexpected result: %+v", res)
	}
	if res.Facets == nil || res.Sort != catalog.SearchByRelevance || res.PageSize != defaultPageSize {
		t.Errorf("missing facets or defaults: %+v", res)
	}

	var bad struct{ Error string }
	getJSON(t, env, "/api/products?platform=ps5", http.StatusBadRequest, &bad)
	if bad.Error != `unknown platform "ps5"` {
		t.Errorf("error message %q", bad.Error)
	}
}

func TestSearchSuggestionsEndpoint(t *testing.T) {
	env := newTestEnv(t)

	var res catalog.SearchResult
	getJSON(t, env, "/api/search/suggestions?q=a", http.StatusOK, &res)
	if len(res.Items) != suggestionsToShow || res.Total <= suggestionsToShow || res.Facets != nil {
		t.Errorf("want %d suggestions out of more, no facets; got %d of %d, facets %v", suggestionsToShow, len(res.Items), res.Total, res.Facets)
	}

	getJSON(t, env, "/api/search/suggestions?q=%20%3F!", http.StatusOK, &res)
	if res.Total != 0 || len(res.Items) != 0 {
		t.Errorf("punctuation-only query should return nothing, got %d", res.Total)
	}

	getJSON(t, env, "/api/search/suggestions?q=witcher%20game", http.StatusOK, &res)
	if res.Total != 0 || res.DidYouMean != "The Witcher 3: Wild Hunt" {
		t.Errorf("did you mean: %+v", res)
	}
}
