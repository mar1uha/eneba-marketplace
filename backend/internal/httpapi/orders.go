package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"eneba-marketplace/backend/internal/catalog"
	"eneba-marketplace/backend/internal/orders"
)

func (a *API) productDetail(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !slugPattern.MatchString(slug) {
		writeError(w, http.StatusNotFound, "Product not found.")
		return
	}
	p, err := a.Catalog.Product(r.Context(), slug)
	if errors.Is(err, catalog.ErrProductNotFound) {
		writeError(w, http.StatusNotFound, "Product not found.")
		return
	}
	if err != nil {
		writeServerError(w, err, "load product", "could not load product")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

type cartItemsRequest struct {
	Items []orders.Item `json:"items"`
}

// quoteCart prices a guest's browser cart.
func (a *API) quoteCart(w http.ResponseWriter, r *http.Request) {
	var req cartItemsRequest
	if decodeJSON(w, r, &req) {
		cart, err := a.Orders.Quote(r.Context(), req.Items)
		respond(w, http.StatusOK, cart, err)
	}
}

func (a *API) getCart(w http.ResponseWriter, r *http.Request) {
	cart, err := a.Orders.Cart(r.Context(), userID(r))
	respond(w, http.StatusOK, cart, err)
}

func (a *API) addCartItem(w http.ResponseWriter, r *http.Request) {
	req := struct {
		OfferID  int64 `json:"offer_id"`
		Quantity int   `json:"quantity"`
	}{Quantity: 1}
	if decodeJSON(w, r, &req) && quantityOK(w, req.Quantity) {
		cart, err := a.Orders.AddItem(r.Context(), userID(r), req.OfferID, req.Quantity)
		respond(w, http.StatusOK, cart, err)
	}
}

func (a *API) setCartItem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Quantity int `json:"quantity"`
	}
	if offerID, ok := pathID(w, r, "offerID"); ok && decodeJSON(w, r, &req) && quantityOK(w, req.Quantity) {
		cart, err := a.Orders.SetQuantity(r.Context(), userID(r), offerID, req.Quantity)
		respond(w, http.StatusOK, cart, err)
	}
}

func (a *API) removeCartItem(w http.ResponseWriter, r *http.Request) {
	if offerID, ok := pathID(w, r, "offerID"); ok {
		cart, err := a.Orders.RemoveItem(r.Context(), userID(r), offerID)
		respond(w, http.StatusOK, cart, err)
	}
}

func (a *API) mergeCart(w http.ResponseWriter, r *http.Request) {
	var req cartItemsRequest
	if decodeJSON(w, r, &req) {
		cart, err := a.Orders.Merge(r.Context(), userID(r), req.Items)
		respond(w, http.StatusOK, cart, err)
	}
}

func (a *API) checkout(w http.ResponseWriter, r *http.Request) {
	order, err := a.Orders.Checkout(r.Context(), userID(r))
	respond(w, http.StatusCreated, order, err)
}

func (a *API) listOrders(w http.ResponseWriter, r *http.Request) {
	list, err := a.Orders.Orders(r.Context(), userID(r))
	respond(w, http.StatusOK, map[string]any{"orders": list}, err)
}

func (a *API) getOrder(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r, "orderID"); ok {
		order, err := a.Orders.Order(r.Context(), userID(r), id)
		respond(w, http.StatusOK, order, err)
	}
}

func (a *API) payOrder(w http.ResponseWriter, r *http.Request) {
	var card orders.Card
	if id, ok := pathID(w, r, "orderID"); ok && decodeJSON(w, r, &card) {
		order, err := a.Orders.Pay(r.Context(), userID(r), id, card)
		respond(w, http.StatusOK, order, err)
	}
}

func (a *API) cancelOrder(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r, "orderID"); ok {
		order, err := a.Orders.Cancel(r.Context(), userID(r), id)
		respond(w, http.StatusOK, order, err)
	}
}

func (a *API) revealKey(w http.ResponseWriter, r *http.Request) {
	orderID, ok := pathID(w, r, "orderID")
	if !ok {
		return
	}
	if keyID, ok := pathID(w, r, "keyID"); ok {
		key, err := a.Orders.RevealKey(r.Context(), userID(r), orderID, keyID)
		respond(w, http.StatusOK, key, err)
	}
}

// respond writes v with status, or maps a cart/order error to its HTTP response.
func respond[T any](w http.ResponseWriter, status int, v T, err error) {
	var stock *orders.StockError
	var card *orders.CardError
	var decline *orders.DeclineError
	switch {
	case err == nil:
		writeJSON(w, status, v)
	case errors.As(err, &stock):
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":    "Some items don't have enough keys left.",
			"code":     "insufficient_stock",
			"problems": stock.Problems,
		})
	case errors.As(err, &card):
		writeFieldError(w, http.StatusBadRequest, card.Field, card.Message)
	case errors.As(err, &decline):
		writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": decline.Message, "code": decline.Code})
	case errors.Is(err, orders.ErrNotFound):
		writeError(w, http.StatusNotFound, "Not found.")
	case errors.Is(err, orders.ErrOfferUnavailable):
		writeError(w, http.StatusNotFound, "This offer is no longer available.")
	case errors.Is(err, orders.ErrQuantityLimit):
		writeError(w, http.StatusConflict, fmt.Sprintf("You can buy up to %d keys from one offer.", orders.MaxQuantity))
	case errors.Is(err, orders.ErrCartFull):
		writeError(w, http.StatusConflict, fmt.Sprintf("Your cart can hold up to %d different offers.", orders.MaxCartLines))
	case errors.Is(err, orders.ErrEmptyCart):
		writeError(w, http.StatusBadRequest, "Your cart is empty.")
	case errors.Is(err, orders.ErrReservationExpired):
		writeJSON(w, http.StatusConflict, map[string]string{
			"error": "Your 10-minute reservation ran out and the keys went back on sale. Check out again to reserve them.",
			"code":  "reservation_expired",
		})
	case errors.Is(err, orders.ErrOrderClosed):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This order can no longer be paid.", "code": "order_closed"})
	default:
		writeServerError(w, err, "shop request failed", "internal error")
	}
}

// userID is the signed-in user; only used behind requireUser.
func userID(r *http.Request) int64 { return currentAuth(r).User.ID }

func quantityOK(w http.ResponseWriter, q int) bool {
	if q < 1 || q > orders.MaxQuantity {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Quantity must be from 1 to %d.", orders.MaxQuantity))
		return false
	}
	return true
}

func pathID(w http.ResponseWriter, r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id < 1 {
		writeError(w, http.StatusNotFound, "Not found.")
		return 0, false
	}
	return id, true
}
