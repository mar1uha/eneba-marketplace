package httpapi

import (
	"net/http"
	"time"
)

func (a *API) homepage(w http.ResponseWriter, r *http.Request) {
	page, err := a.Homepage.Page(r.Context(), time.Now().UTC())
	if err != nil {
		writeServerError(w, err, "load homepage", "could not load homepage")
		return
	}
	writeJSON(w, http.StatusOK, page)
}
