package catalog

import "testing"

func TestDiscountPercent(t *testing.T) {
	cases := []struct {
		msrp, price, want int
	}{
		{5999, 2759, 54},
		{5999, 5999, 0},
		{1000, 1200, 0},
		{0, 500, 0},
		{1000, 1, 99},
	}
	for _, c := range cases {
		if got := discountPercent(c.msrp, c.price); got != c.want {
			t.Errorf("discountPercent(%d, %d) = %d, want %d", c.msrp, c.price, got, c.want)
		}
	}
}
