package httpapi

import "net/http"

// listOrders is protected now so the access rules are in place; orders are created in Part 5.
func (a *API) listOrders(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"orders": []any{}})
}
