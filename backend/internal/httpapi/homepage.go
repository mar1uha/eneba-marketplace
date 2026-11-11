package httpapi

import (
	"log/slog"
	"net/http"
	"time"
)

func (a *API) homepage(w http.ResponseWriter, r *http.Request) {
	page, err := a.Homepage.Page(r.Context(), time.Now().UTC())
	if err != nil {
		slog.Error("load homepage", "err", err)
		writeError(w, http.StatusInternalServerError, "could not load homepage")
		return
	}
	writeJSON(w, http.StatusOK, page)
}
