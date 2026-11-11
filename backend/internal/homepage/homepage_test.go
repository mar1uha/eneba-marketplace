package homepage

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"eneba-marketplace/backend/internal/catalog"
	"eneba-marketplace/backend/internal/db"
)

func TestDailySlot(t *testing.T) {
	now := time.Date(2026, 11, 11, 16, 35, 0, 0, time.UTC)
	idx, endsAt := dailySlot(7, now)

	if want := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC); !endsAt.Equal(want) {
		t.Errorf("endsAt = %v, want %v", endsAt, want)
	}
	if again, _ := dailySlot(7, now.Add(7*time.Hour)); again != idx {
		t.Errorf("index changed within the same UTC day: %d -> %d", idx, again)
	}
	if next, _ := dailySlot(7, endsAt); next != (idx+1)%7 {
		t.Errorf("next day index = %d, want %d", next, (idx+1)%7)
	}
	// A non-UTC clock must map to the same UTC day.
	vilnius := time.FixedZone("EET", 2*60*60)
	if local, _ := dailySlot(7, now.In(vilnius)); local != idx {
		t.Errorf("timezone changed the slot: %d vs %d", local, idx)
	}
}

func testService(t *testing.T) (*Service, *pgxpool.Pool) {
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
	return NewService(pool, catalog.NewStore(pool)), pool
}

func insertBlock(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	var id int64
	if err := pool.QueryRow(context.Background(), sql+" RETURNING id", args...).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), "DELETE FROM homepage_blocks WHERE id = $1", id)
	})
}

func TestPageSeeded(t *testing.T) {
	svc, pool := testService(t)
	ctx := context.Background()
	now := time.Now().UTC()

	page, err := svc.Page(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Blocks) != 6 {
		t.Fatalf("got %d blocks, want 6 seeded blocks", len(page.Blocks))
	}
	for i := 1; i < len(page.Blocks); i++ {
		if page.Blocks[i-1].Position > page.Blocks[i].Position {
			t.Errorf("blocks out of order at %d", i)
		}
	}

	for _, b := range page.Blocks {
		switch data := b.Data.(type) {
		case CarouselData:
			for _, p := range data.Products {
				var minPrice int
				err := pool.QueryRow(ctx, "SELECT min(price_cents) FROM offers WHERE product_id = $1 AND is_active", p.ID).Scan(&minPrice)
				if err != nil {
					t.Fatal(err)
				}
				if p.PriceCents != minPrice {
					t.Errorf("%s: card price %d, cheapest offer %d", p.Slug, p.PriceCents, minPrice)
				}
			}
			if b.Title == "Best sellers" {
				assertSoldCountDescending(t, pool, data.Products)
			}
		case DealData:
			if !data.EndsAt.After(now) || data.EndsAt.Sub(now) > 24*time.Hour {
				t.Errorf("deal ends_at %v not within the next 24h", data.EndsAt)
			}
		case HeroData:
			if len(data.Slides) != 5 {
				t.Errorf("hero has %d slides, want 5", len(data.Slides))
			}
			for _, s := range data.Slides {
				if s.ImageURL == "" || s.CTAHref == "" || s.Product == nil {
					t.Errorf("hero slide %q not fully resolved: %+v", s.Title, s)
				}
			}
		default:
			t.Errorf("block %d has unexpected data type %T", b.ID, b.Data)
		}
	}
}

func assertSoldCountDescending(t *testing.T, pool *pgxpool.Pool, cards []catalog.ProductCard) {
	t.Helper()
	prev := int(^uint(0) >> 1)
	for _, c := range cards {
		var sold int
		if err := pool.QueryRow(context.Background(), "SELECT sold_count FROM products WHERE id = $1", c.ID).Scan(&sold); err != nil {
			t.Fatal(err)
		}
		if sold > prev {
			t.Errorf("best sellers not sorted: %s has %d after %d", c.Slug, sold, prev)
		}
		prev = sold
	}
}

func TestPageHidesInactiveScheduledAndBrokenBlocks(t *testing.T) {
	svc, pool := testService(t)
	now := time.Now().UTC()

	before, err := svc.Page(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}

	carousel := `INSERT INTO homepage_blocks (block_type, position, title, config, is_active, starts_at, ends_at) VALUES ('product_carousel', 1, $1, $2, $3, $4, $5)`
	valid := `{"source": "best_selling"}`
	insertBlock(t, pool, carousel, "inactive", valid, false, nil, nil)
	insertBlock(t, pool, carousel, "not started", valid, true, now.Add(time.Hour), nil)
	insertBlock(t, pool, carousel, "expired", valid, true, now.Add(-2*time.Hour), now.Add(-time.Hour))
	insertBlock(t, pool, carousel, "unknown source", `{"source": "random"}`, true, nil, nil)
	insertBlock(t, pool, carousel, "missing products", `{"source": "manual", "product_slugs": ["does-not-exist"]}`, true, nil, nil)
	insertBlock(t, pool, carousel, "malformed", `{"limit": "twelve"}`, true, nil, nil)

	after, err := svc.Page(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Blocks) != len(before.Blocks) {
		for _, b := range after.Blocks {
			t.Logf("visible: %d %s %q", b.ID, b.Type, b.Title)
		}
		t.Fatalf("got %d blocks, want %d: hidden or broken blocks leaked", len(after.Blocks), len(before.Blocks))
	}
}

func TestDealEndsWithBlockSchedule(t *testing.T) {
	svc, pool := testService(t)
	now := time.Date(2026, 11, 11, 12, 0, 0, 0, time.UTC)
	blockEnd := now.Add(90 * time.Minute)

	insertBlock(t, pool,
		`INSERT INTO homepage_blocks (block_type, position, title, config, ends_at) VALUES ('deal', 0, 'flash deal', $1, $2)`,
		`{"rotation": "daily", "product_slugs": ["does-not-exist", "elden-ring"]}`, blockEnd)

	page, err := svc.Page(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	deal, ok := page.Blocks[0].Data.(DealData)
	if !ok || page.Blocks[0].Title != "flash deal" {
		t.Fatalf("first block is %q (%T), want the flash deal", page.Blocks[0].Title, page.Blocks[0].Data)
	}
	if !deal.EndsAt.Equal(blockEnd) {
		t.Errorf("deal ends_at = %v, want block end %v", deal.EndsAt, blockEnd)
	}
	if deal.Product.Slug != "elden-ring" {
		t.Errorf("deal product = %s, want fallback to elden-ring", deal.Product.Slug)
	}
}
