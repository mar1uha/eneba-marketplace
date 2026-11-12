package httpapi

import (
	"context"
	"net/http"
	"os"
	"time"
)

type healthResponse struct {
	Status string `json:"status"`
	DB     string `json:"db"`
	// Version is the deployed git commit (Render sets RENDER_GIT_COMMIT), so you can tell which build is live.
	Version string `json:"version,omitempty"`
}

var version = os.Getenv("RENDER_GIT_COMMIT")

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := a.DB.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, healthResponse{Status: "degraded", DB: "down", Version: version})
		return
	}
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok", DB: "ok", Version: version})
}
