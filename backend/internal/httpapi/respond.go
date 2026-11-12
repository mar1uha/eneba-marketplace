package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"net/http"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("encode response", "err", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// statusClientClosedRequest is nginx's code for a request the client abandoned. Only the access log sees it.
const statusClientClosedRequest = 499

// writeServerError sends a 500, unless the failure came from the client abandoning the request
// (the browser navigated away), which is not a server fault.
func writeServerError(w http.ResponseWriter, err error, logMsg, publicMsg string) {
	if errors.Is(err, context.Canceled) {
		w.WriteHeader(statusClientClosedRequest)
		return
	}
	slog.Error(logMsg, "err", err)
	writeError(w, http.StatusInternalServerError, publicMsg)
}

// writeFieldError names the form field at fault, so the frontend can show the message next to it.
func writeFieldError(w http.ResponseWriter, status int, field, msg string) {
	writeJSON(w, status, map[string]string{"error": msg, "field": field})
}

const maxJSONBody = 64 << 10

// decodeJSON requires a JSON content type: HTML forms cannot send one cross-site without a CORS preflight.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "Expected a JSON body.")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body.")
		return false
	}
	return true
}
