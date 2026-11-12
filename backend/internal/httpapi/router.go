package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"eneba-marketplace/backend/internal/auth"
	"eneba-marketplace/backend/internal/homepage"
)

type API struct {
	DB       *pgxpool.Pool
	Homepage *homepage.Service
	Auth     *auth.Service
	// Google is nil when Google sign-in is not configured.
	Google       *auth.GoogleOAuth
	CookieSecure bool
}

func NewRouter(api *API, corsOrigins []string) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Logger, middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   corsOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Route("/api", func(r chi.Router) {
		r.Use(rejectCrossSite(corsOrigins))

		r.Get("/health", api.health)
		r.Get("/homepage", api.homepage)

		r.Route("/auth", func(r chi.Router) {
			r.Use(api.loadSession)
			r.Get("/me", api.me)
			r.Get("/providers", api.authProviders)
			r.Post("/register", api.register)
			r.Post("/login", api.login)
			r.Post("/logout", api.logout)
			r.Post("/password-reset/request", api.requestPasswordReset)
			r.Post("/password-reset/confirm", api.confirmPasswordReset)
			r.Get("/google/start", api.googleStart)
			r.Get("/google/callback", api.googleCallback)

			r.Group(func(r chi.Router) {
				r.Use(requireUser)
				r.Post("/password", api.changePassword)
				r.Get("/sessions", api.listSessions)
				r.Delete("/sessions/{id}", api.revokeSession)
				r.Post("/sessions/revoke-others", api.revokeOtherSessions)
			})
		})

		r.Group(func(r chi.Router) {
			r.Use(api.loadSession, requireUser)
			r.Get("/orders", api.listOrders)
		})
	})

	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	return r
}
