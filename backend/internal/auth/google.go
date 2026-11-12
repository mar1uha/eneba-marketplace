package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"golang.org/x/oauth2"
)

type GoogleEndpoints struct {
	AuthURL     string
	TokenURL    string
	UserinfoURL string
}

var DefaultGoogleEndpoints = GoogleEndpoints{
	AuthURL:     "https://accounts.google.com/o/oauth2/v2/auth",
	TokenURL:    "https://oauth2.googleapis.com/token",
	UserinfoURL: "https://openidconnect.googleapis.com/v1/userinfo",
}

// GoogleOAuth runs the OpenID Connect authorization-code flow with PKCE.
type GoogleOAuth struct {
	config      oauth2.Config
	userinfoURL string
}

func NewGoogleOAuth(clientID, clientSecret, redirectURL string, endpoints GoogleEndpoints) *GoogleOAuth {
	return &GoogleOAuth{
		config: oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
			Scopes:       []string{"openid", "email", "profile"},
			Endpoint:     oauth2.Endpoint{AuthURL: endpoints.AuthURL, TokenURL: endpoints.TokenURL, AuthStyle: oauth2.AuthStyleInParams},
		},
		userinfoURL: endpoints.UserinfoURL,
	}
}

func (g *GoogleOAuth) AuthCodeURL(state, verifier string) string {
	return g.config.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier), oauth2.SetAuthURLParam("prompt", "select_account"))
}

// Exchange trades the authorization code for tokens over a direct TLS call to Google,
// then reads the profile from the userinfo endpoint with the access token.
func (g *GoogleOAuth) Exchange(ctx context.Context, code, verifier string) (GoogleProfile, error) {
	token, err := g.config.Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return GoogleProfile{}, fmt.Errorf("exchange code: %w", err)
	}
	resp, err := g.config.Client(ctx, token).Get(g.userinfoURL)
	if err != nil {
		return GoogleProfile{}, fmt.Errorf("fetch userinfo: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return GoogleProfile{}, fmt.Errorf("fetch userinfo: status %d", resp.StatusCode)
	}
	var info struct {
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return GoogleProfile{}, fmt.Errorf("decode userinfo: %w", err)
	}
	return GoogleProfile{Sub: info.Sub, Email: info.Email, EmailVerified: info.EmailVerified, Name: info.Name}, nil
}

func NewPKCEVerifier() string {
	return oauth2.GenerateVerifier()
}

func NewState() string {
	return newToken()
}
