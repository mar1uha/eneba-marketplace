package config

import (
	"errors"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port        string
	DatabaseURL string
	CORSOrigins []string
	// AppBaseURL is the public frontend origin, used to build links in emails.
	AppBaseURL   string
	CookieSecure bool
	Google       GoogleConfig
}

type GoogleConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

func (g GoogleConfig) Enabled() bool {
	return g.ClientID != "" && g.ClientSecret != ""
}

func Load() (Config, error) {
	_ = godotenv.Load()

	appBaseURL := strings.TrimRight(getenv("APP_BASE_URL", "http://localhost:5173"), "/")
	cfg := Config{
		Port:         getenv("PORT", "8080"),
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		CORSOrigins:  strings.Split(getenv("CORS_ORIGINS", "http://localhost:5173"), ","),
		AppBaseURL:   appBaseURL,
		CookieSecure: getenv("COOKIE_SECURE", "true") != "false",
		Google: GoogleConfig{
			ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
			ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
			RedirectURL:  getenv("GOOGLE_REDIRECT_URL", appBaseURL+"/api/auth/google/callback"),
		},
	}
	if cfg.DatabaseURL == "" {
		return cfg, errors.New("DATABASE_URL is required")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
