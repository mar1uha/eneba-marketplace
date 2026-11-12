package catalog

import (
	"context"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"eneba-marketplace/backend/internal/db"
)

// These tests run against the seeded demo catalog (migrations 00004 and 00008).
func testStore(t *testing.T) (*Store, *pgxpool.Pool) {
	t.Helper()
	_ = godotenv.Load("../../.env")
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	return NewStore(pool), pool
}

func search(t *testing.T, s *Store, q SearchQuery) SearchResult {
	t.Helper()
	if q.Page == 0 {
		q.Page = 1
	}
	if q.PageSize == 0 {
		q.PageSize = 24
	}
	res, err := s.Search(context.Background(), q, true)
	if err != nil {
		t.Fatalf("search %+v: %v", q, err)
	}
	return res
}

func titles(cards []ProductCard) []string {
	out := make([]string, len(cards))
	for i, c := range cards {
		out[i] = c.Title
	}
	return out
}

func TestSearchFindsTyposPartialNamesAndAliases(t *testing.T) {
	s, _ := testStore(t)
	cases := []struct{ query, wantFirst string }{
		{"cyberpnk", "Cyberpunk 2077"},                          // missing letter
		{"witcer", "The Witcher 3: Wild Hunt"},                  // missing letter
		{"wichter", "The Witcher 3: Wild Hunt"},                 // swapped letters
		{"eldn ring", "ELDEN RING"},                             // typo in one of two words
		{"assasins creed", "Assassin's Creed Shadows"},          // typo; best seller of the series first
		{"witch", "The Witcher 3: Wild Hunt"},                   // partial word
		{"red dead", "Red Dead Redemption 2"},                   // partial title
		{"silk", "Hollow Knight: Silksong"},                     // partial word inside the title
		{"baldurs gate", "Baldur's Gate 3"},                     // apostrophe left out
		{"stalker 2", "S.T.A.L.K.E.R. 2: Heart of Chornobyl"},   // dots left out
		{"warhammer 40000", "Warhammer 40,000: Space Marine 2"}, // comma left out
		{"cyber punk", "Cyberpunk 2077"},                        // extra space
		{"halflife", "Half-Life: Alyx"},                         // hyphen left out
		{"gta 5", "Grand Theft Auto V"},                         // alias
		{"bg3", "Baldur's Gate 3"},                              // alias
		{"HADES", "Hades"},                                      // case; exact title beats "Hades II"
	}
	for _, c := range cases {
		res := search(t, s, SearchQuery{Text: c.query})
		if res.Sort != SearchByRelevance {
			t.Errorf("%q: sort = %q, want relevance", c.query, res.Sort)
		}
		if len(res.Items) == 0 || res.Items[0].Title != c.wantFirst {
			t.Errorf("%q: got %v, want %q first", c.query, titles(res.Items), c.wantFirst)
		}
	}
}

func TestSearchAvoidsLooseMatches(t *testing.T) {
	s, _ := testStore(t)
	for _, q := range []string{"mario", "zelda", "cod", "frostpunk"} {
		if res := search(t, s, SearchQuery{Text: q}); res.Total != 0 {
			t.Errorf("%q matched %v", q, titles(res.Items))
		}
	}
	// Typo matches keep the first letter: "wichter" is 2 edits from both "witcher" and "fighter".
	res := search(t, s, SearchQuery{Text: "wichter"})
	if slices.Contains(titles(res.Items), "Street Fighter 6") {
		t.Errorf("wichter matched Street Fighter 6: %v", titles(res.Items))
	}
	// Short tokens need an exact word start: "ac" matches the Assassin's Creed alias, not "black" or "space".
	for _, c := range search(t, s, SearchQuery{Text: "ac", PageSize: 48}).Items {
		if !strings.HasPrefix(c.Title, "Assassin's Creed") && !strings.HasPrefix(c.Title, "ARMORED CORE") {
			t.Errorf("ac matched %q", c.Title)
		}
	}
}

func TestDidYouMean(t *testing.T) {
	s, _ := testStore(t)

	res := search(t, s, SearchQuery{Text: "witcher game"})
	if res.Total != 0 || res.DidYouMean != "The Witcher 3: Wild Hunt" {
		t.Errorf("witcher game: total %d, did you mean %q", res.Total, res.DidYouMean)
	}
	res = search(t, s, SearchQuery{Text: "red dead redemption 3"})
	if res.DidYouMean != "Red Dead Redemption 2" {
		t.Errorf("red dead redemption 3: did you mean %q", res.DidYouMean)
	}
	if res = search(t, s, SearchQuery{Text: "zelda"}); res.DidYouMean != "" {
		t.Errorf("zelda: did you mean %q, want none", res.DidYouMean)
	}
	// The text matches without filters, so the filter is the problem, not the spelling.
	res = search(t, s, SearchQuery{Text: "witcher", Platforms: []string{"xbox"}})
	if res.Total != 0 || res.DidYouMean != "" {
		t.Errorf("witcher on xbox: total %d, did you mean %q", res.Total, res.DidYouMean)
	}
}

func TestSearchFiltersCombineAndFacetsIgnoreTheirOwnDimension(t *testing.T) {
	s, pool := testStore(t)
	q := SearchQuery{Platforms: []string{"steam", "nintendo"}, Genres: []string{"roguelike"}, MaxPriceCents: 1500, PageSize: 48}
	res := search(t, s, q)
	if res.Total == 0 || res.Total != len(res.Items) {
		t.Fatalf("total %d, items %d", res.Total, len(res.Items))
	}
	for _, c := range res.Items {
		var isRoguelike bool
		err := pool.QueryRow(context.Background(), `
			SELECT EXISTS (SELECT 1 FROM product_genres pg JOIN genres g ON g.id = pg.genre_id
			               WHERE pg.product_id = $1 AND g.slug = 'roguelike')`, c.ID).Scan(&isRoguelike)
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Contains(q.Platforms, c.Platform) || c.PriceCents > q.MaxPriceCents || !isRoguelike {
			t.Errorf("%s (%s, %d cents, roguelike %v) does not match the filters", c.Title, c.Platform, c.PriceCents, isRoguelike)
		}
	}

	// Each facet count must equal the total of the same search with that one option selected instead.
	check := func(name string, counts []FacetCount, with func(SearchQuery, string) SearchQuery) {
		t.Helper()
		for _, fc := range counts {
			if got := search(t, s, with(q, fc.Value)).Total; got != fc.Count {
				t.Errorf("%s %s: facet count %d, but selecting it gives %d", name, fc.Value, fc.Count, got)
			}
		}
	}
	check("platform", res.Facets.Platforms, func(q SearchQuery, v string) SearchQuery { q.Platforms = []string{v}; return q })
	check("region", res.Facets.Regions, func(q SearchQuery, v string) SearchQuery { q.Regions = []string{v}; return q })
	check("genre", res.Facets.Genres, func(q SearchQuery, v string) SearchQuery { q.Genres = []string{v}; return q })
	if len(res.Facets.Platforms) != len(Platforms) || len(res.Facets.Regions) != len(Regions) || len(res.Facets.Genres) != 15 {
		t.Errorf("facets must list every option: %d platforms, %d regions, %d genres",
			len(res.Facets.Platforms), len(res.Facets.Regions), len(res.Facets.Genres))
	}

	// The price range ignores the price filter, so it shows prices above the current maximum.
	noPrice := q
	noPrice.MaxPriceCents = 0
	all := search(t, s, noPrice)
	lo, hi := all.Items[0].PriceCents, all.Items[0].PriceCents
	for _, c := range all.Items {
		lo, hi = min(lo, c.PriceCents), max(hi, c.PriceCents)
	}
	if p := res.Facets.Price; p == nil || p.MinCents != lo || p.MaxCents != hi {
		t.Errorf("price range %+v, want %d..%d from the results without the price filter", p, lo, hi)
	}
	if hi <= q.MaxPriceCents {
		t.Errorf("seed has no result above the price cap, so this test proves nothing")
	}
}

func TestSearchPriceBoundsAreInclusive(t *testing.T) {
	s, _ := testStore(t)
	target := search(t, s, SearchQuery{Text: "Elden Ring"}).Items[0]
	res := search(t, s, SearchQuery{MinPriceCents: target.PriceCents, MaxPriceCents: target.PriceCents, PageSize: 48})
	if !slices.ContainsFunc(res.Items, func(c ProductCard) bool { return c.ID == target.ID }) {
		t.Errorf("price %d..%d does not include %s at %d", target.PriceCents, target.PriceCents, target.Title, target.PriceCents)
	}
	for _, c := range res.Items {
		if c.PriceCents != target.PriceCents {
			t.Errorf("%s costs %d, outside %d..%d", c.Title, c.PriceCents, target.PriceCents, target.PriceCents)
		}
	}
}

func TestSearchSortsAndPaginates(t *testing.T) {
	s, _ := testStore(t)
	ctx := context.Background()

	browse := search(t, s, SearchQuery{PageSize: 10})
	if browse.Sort != SearchByBestSelling {
		t.Errorf("default sort without text = %q, want best_selling", browse.Sort)
	}
	best, err := s.ListCards(ctx, SortBestSelling, 10)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(titles(browse.Items), titles(best)) {
		t.Errorf("best selling order %v, want %v", titles(browse.Items), titles(best))
	}
	if res := search(t, s, SearchQuery{Sort: SearchByRelevance, PageSize: 10}); res.Sort != SearchByBestSelling {
		t.Errorf("relevance without text should fall back to best_selling, got %q", res.Sort)
	}

	for _, sort := range []SearchSort{SearchByPriceAsc, SearchByPriceDesc} {
		page1 := search(t, s, SearchQuery{Sort: sort, Page: 1, PageSize: 24})
		page2 := search(t, s, SearchQuery{Sort: sort, Page: 2, PageSize: 24})
		both := append(slices.Clone(page1.Items), page2.Items...)
		for i := 1; i < len(both); i++ {
			if (sort == SearchByPriceAsc && both[i].PriceCents < both[i-1].PriceCents) ||
				(sort == SearchByPriceDesc && both[i].PriceCents > both[i-1].PriceCents) {
				t.Errorf("%s out of order at %d: %d then %d", sort, i, both[i-1].PriceCents, both[i].PriceCents)
			}
		}
		seen := map[int64]bool{}
		for _, c := range both {
			if seen[c.ID] {
				t.Errorf("%s: %s appears on both pages", sort, c.Title)
			}
			seen[c.ID] = true
		}
		if page1.Total != page2.Total {
			t.Errorf("%s: total changed between pages: %d vs %d", sort, page1.Total, page2.Total)
		}
	}

	last := (browse.Total + 23) / 24
	beyond := search(t, s, SearchQuery{Page: last + 1, PageSize: 24})
	if len(beyond.Items) != 0 || beyond.Total != browse.Total {
		t.Errorf("page past the end: %d items, total %d (want 0 items, total %d)", len(beyond.Items), beyond.Total, browse.Total)
	}
}

func TestSearchSkipsProductsWithoutActiveOffers(t *testing.T) {
	s, pool := testStore(t)
	ctx := context.Background()
	var productID int64
	err := pool.QueryRow(ctx, `
		INSERT INTO products (slug, title, cover_url, banner_url, platform, region, msrp_cents)
		VALUES ('zzyzx-search-test', 'Zzyzx Search Test', 'https://cdn.test/c.jpg', 'https://cdn.test/b.jpg', 'steam', 'global', 1000)
		RETURNING id`).Scan(&productID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM products WHERE id = $1", productID) })

	if res := search(t, s, SearchQuery{Text: "zzyzx"}); res.Total != 0 {
		t.Errorf("product without offers was listed")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO offers (product_id, seller_id, price_cents, is_active)
		SELECT $1, id, 1000, false FROM sellers ORDER BY id LIMIT 1`, productID); err != nil {
		t.Fatal(err)
	}
	if res := search(t, s, SearchQuery{Text: "zzyzx"}); res.Total != 0 {
		t.Errorf("product with only an inactive offer was listed")
	}
	if _, err := pool.Exec(ctx, `UPDATE offers SET is_active = true WHERE product_id = $1`, productID); err != nil {
		t.Fatal(err)
	}
	if res := search(t, s, SearchQuery{Text: "zzyzx"}); res.Total != 1 {
		t.Errorf("product with an active offer: total %d, want 1", res.Total)
	}
}
