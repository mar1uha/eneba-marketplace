package orders

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// FuzzCardCheck throws arbitrary form input at the card validator: it must never panic, and
// whatever it accepts must be a listed test card with a coherent brand and last 4 digits.
// Run longer with: go test ./internal/orders -run '^$' -fuzz FuzzCardCheck -fuzztime 30s
func FuzzCardCheck(f *testing.F) {
	f.Add("Ada", "4242 4242 4242 4242", "12/34", "123")
	f.Add("Ada", "4000-0000-0000-0002", "1/30", "999")
	f.Add("", "5", "13/99", "")
	f.Add("x", "٤٢٤٢٤٢٤٢٤٢٤٢٤٢٤٢", " 12 / 34 ", "12a")
	f.Add("Ada", "4111111111111111", "00/00", "1234")
	now := time.Date(2026, 11, 12, 12, 0, 0, 0, time.UTC)
	f.Fuzz(func(t *testing.T, name, number, expiry, cvc string) {
		ch, err := Card{Name: name, Number: number, Expiry: expiry, CVC: cvc}.check(now)
		if err != nil {
			return
		}
		digits := strings.NewReplacer(" ", "", "-", "", "\t", "", "\n", "", "\r", "", "\v", "", "\f", "").Replace(number)
		if _, listed := testCards[nonDigits.ReplaceAllString(number, "")]; !listed {
			t.Fatalf("accepted a card that is not a test card: %q", number)
		}
		if ch.brand == "" || len(ch.last4) != 4 || !strings.HasSuffix(digits, ch.last4) {
			t.Fatalf("incoherent charge %+v for %q", ch, number)
		}
	})
}

// FuzzNormalizeItems feeds arbitrary guest-cart JSON through the normalizer that runs before SQL.
func FuzzNormalizeItems(f *testing.F) {
	f.Add(`[{"offer_id":1,"quantity":2,"added_price_cents":999}]`)
	f.Add(`[{"offer_id":1,"quantity":9},{"offer_id":1,"quantity":9},{"offer_id":-4,"quantity":1}]`)
	f.Add(`[{"offer_id":7,"quantity":1,"added_price_cents":9999999999}]`)
	f.Fuzz(func(t *testing.T, raw string) {
		var items []Item
		if json.Unmarshal([]byte(raw), &items) != nil {
			return
		}
		out := normalizeItems(items)
		if len(out) > MaxCartLines {
			t.Fatalf("%d lines kept", len(out))
		}
		seen := map[int64]bool{}
		for _, it := range out {
			if it.OfferID <= 0 || seen[it.OfferID] {
				t.Fatalf("bad or duplicate offer %d", it.OfferID)
			}
			seen[it.OfferID] = true
			if it.Quantity < 1 || it.Quantity > MaxQuantity {
				t.Fatalf("quantity %d kept", it.Quantity)
			}
			if it.AddedPriceCents < 0 || it.AddedPriceCents > maxAddedPriceCents {
				t.Fatalf("added price %d kept", it.AddedPriceCents)
			}
		}
	})
}
