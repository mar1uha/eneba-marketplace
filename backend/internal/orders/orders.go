// Package orders holds the cart, checkout with key reservation, simulated card payment, and order history.
package orders

import (
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	MaxQuantity    = 10
	MaxCartLines   = 20
	ReservationTTL = 10 * time.Minute
)

var (
	ErrNotFound           = errors.New("not found")
	ErrOfferUnavailable   = errors.New("offer is not available")
	ErrCartFull           = errors.New("cart is full")
	ErrEmptyCart          = errors.New("cart is empty")
	ErrReservationExpired = errors.New("reservation expired")
	ErrOrderClosed        = errors.New("order is no longer awaiting payment")
)

// StockError lists cart lines asking for more keys than are for sale.
type StockError struct {
	Problems []StockProblem
}

type StockProblem struct {
	OfferID   int64 `json:"offer_id"`
	Available int   `json:"available"`
}

func (e *StockError) Error() string { return "not enough stock" }

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

type ProductRef struct {
	Slug     string `json:"slug"`
	Title    string `json:"title"`
	CoverURL string `json:"cover_url"`
	Platform string `json:"platform"`
	Region   string `json:"region"`
}

type SellerRef struct {
	Name   string  `json:"name"`
	Rating float64 `json:"rating"`
}

type Order struct {
	ID int64 `json:"id"`
	// Status is pending, paid, cancelled, or expired (a pending order past reserved_until).
	Status        string     `json:"status"`
	TotalCents    int        `json:"total_cents"`
	CreatedAt     time.Time  `json:"created_at"`
	ReservedUntil time.Time  `json:"reserved_until"`
	PaidAt        *time.Time `json:"paid_at"`
	// ServerTime lets the browser run the reservation countdown on the server's clock.
	ServerTime time.Time       `json:"server_time"`
	Items      []OrderItem     `json:"items"`
	Payment    *PaymentSummary `json:"payment"`
}

type OrderItem struct {
	ID             int64      `json:"id"`
	OfferID        int64      `json:"offer_id"`
	Product        ProductRef `json:"product"`
	SellerName     string     `json:"seller_name"`
	UnitPriceCents int        `json:"unit_price_cents"`
	Quantity       int        `json:"quantity"`
	// Keys are listed once the order is paid. Code stays null until the buyer reveals it.
	Keys []Key `json:"keys"`
}

type Key struct {
	ID         int64      `json:"id"`
	Code       *string    `json:"code"`
	RevealedAt *time.Time `json:"revealed_at"`
}

type PaymentSummary struct {
	CardBrand string `json:"card_brand"`
	CardLast4 string `json:"card_last4"`
}

type OrderSummary struct {
	ID         int64        `json:"id"`
	Status     string       `json:"status"`
	TotalCents int          `json:"total_cents"`
	CreatedAt  time.Time    `json:"created_at"`
	ItemCount  int          `json:"item_count"`
	Products   []ProductRef `json:"products"`
}

// statusSQL reads a pending order whose reservation has run out as expired (orders alias o).
const statusSQL = `CASE WHEN o.status = 'pending' AND o.reserved_until < now() THEN 'expired' ELSE o.status END`
