package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"eneba-marketplace/backend/internal/auth"
	"eneba-marketplace/backend/internal/catalog"
	"eneba-marketplace/backend/internal/homepage"
	"eneba-marketplace/backend/internal/orders"
)

type API struct {
	DB       *pgxpool.Pool
	Catalog  *catalog.Store
	Homepage *homepage.Service
	Auth     *auth.Service
	Orders   *orders.Service
	// Google is nil when Google sign-in is not configured.
	Google       *auth.GoogleOAuth
	CookieSecure bool
}

func NewRouter(api *API, corsOrigins []string) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Logger, middleware.Recoverer, privateResponses)
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
		r.Get("/products", api.listProducts)
		r.Get("/products/{slug}", api.productDetail)
		r.Get("/search/suggestions", api.searchSuggestions)
		r.Post("/cart/quote", api.quoteCart)

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
			r.Get("/cart", api.getCart)
			r.Post("/cart/items", api.addCartItem)
			r.Put("/cart/items/{offerID}", api.setCartItem)
			r.Delete("/cart/items/{offerID}", api.removeCartItem)
			r.Post("/cart/merge", api.mergeCart)
			r.Post("/checkout", api.checkout)
			r.Get("/orders", api.listOrders)
			r.Get("/orders/{orderID}", api.getOrder)
			r.Post("/orders/{orderID}/pay", api.payOrder)
			r.Post("/orders/{orderID}/cancel", api.cancelOrder)
			r.Post("/orders/{orderID}/keys/{keyID}/reveal", api.revealKey)
		})
	})

	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	return r
}

// privateResponses keeps every response out of shared and browser caches and stops browsers from
// sniffing JSON as another content type. Responses carry account, cart and order data, and without a
// Cache-Control of their own the Vercel proxy marked them "public".
func privateResponses(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}
