package orders

import (
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Card is the simulated card form. The number is used to pick a test outcome and is never stored.
type Card struct {
	Name   string `json:"name"`
	Number string `json:"number"`
	// Expiry is MM/YY.
	Expiry string `json:"expiry"`
	CVC    string `json:"cvc"`
}

// CardError is a form mistake, reported on the field at fault.
type CardError struct {
	Field   string
	Message string
}

func (e *CardError) Error() string { return e.Message }

// DeclineError is a payment the simulated bank refused.
type DeclineError struct {
	Code    string
	Message string
}

func (e *DeclineError) Error() string { return e.Message }

// testCards mirror Stripe's test mode. Any other number is refused, so nobody types a real card into a demo.
var testCards = map[string]*DeclineError{
	"4242424242424242": nil,
	"5555555555554444": nil,
	"4000000000000002": {Code: "card_declined", Message: "Your card was declined."},
	"4000000000009995": {Code: "insufficient_funds", Message: "Your card has insufficient funds."},
}

var (
	nonDigits     = regexp.MustCompile(`[\s-]`)
	expiryPattern = regexp.MustCompile(`^\s*(\d{1,2})\s*/\s*(\d{2})\s*$`)
	cvcPattern    = regexp.MustCompile(`^\d{3}$`)
)

type charge struct {
	brand   string
	last4   string
	decline *DeclineError
}

// check validates the form in the order its fields appear and picks the test outcome.
func (c Card) check(now time.Time) (charge, error) {
	if name := strings.TrimSpace(c.Name); name == "" || utf8.RuneCountInString(name) > 100 {
		return charge{}, &CardError{"name", "Enter the name on the card."}
	}
	digits := nonDigits.ReplaceAllString(c.Number, "")
	if len(digits) < 12 || len(digits) > 19 || !luhnValid(digits) {
		return charge{}, &CardError{"number", "Enter a valid card number."}
	}
	decline, ok := testCards[digits]
	if !ok {
		return charge{}, &CardError{"number", "Use a test card such as 4242 4242 4242 4242. This demo never charges real cards."}
	}
	m := expiryPattern.FindStringSubmatch(c.Expiry)
	if m == nil {
		return charge{}, &CardError{"expiry", "Enter the expiry date as MM/YY."}
	}
	month, _ := strconv.Atoi(m[1])
	year, _ := strconv.Atoi(m[2])
	if month < 1 || month > 12 {
		return charge{}, &CardError{"expiry", "Enter the expiry date as MM/YY."}
	}
	// A card is valid through the last day of its expiry month.
	if !now.Before(time.Date(2000+year, time.Month(month)+1, 1, 0, 0, 0, 0, time.UTC)) {
		return charge{}, &CardError{"expiry", "This card has expired."}
	}
	if !cvcPattern.MatchString(strings.TrimSpace(c.CVC)) {
		return charge{}, &CardError{"cvc", "Enter the 3-digit security code."}
	}
	return charge{brand: cardBrand(digits), last4: digits[len(digits)-4:], decline: decline}, nil
}

func luhnValid(digits string) bool {
	sum := 0
	double := false
	for i := len(digits) - 1; i >= 0; i-- {
		d := int(digits[i] - '0')
		if d < 0 || d > 9 {
			return false
		}
		if double {
			if d *= 2; d > 9 {
				d -= 9
			}
		}
		sum += d
		double = !double
	}
	return sum%10 == 0
}

func cardBrand(digits string) string {
	switch {
	case strings.HasPrefix(digits, "4"):
		return "visa"
	case digits[0] == '5' && digits[1] >= '1' && digits[1] <= '5':
		return "mastercard"
	case strings.HasPrefix(digits, "34"), strings.HasPrefix(digits, "37"):
		return "amex"
	default:
		return "card"
	}
}
