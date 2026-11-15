package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

const sessionCookie = "kb_session"

type Identity = clusters.Identity

type oidcConfig struct {
	issuer       string
	clientID     string
	clientSecret string
	redirectURL  string
	signingKey   []byte
	authURL      string
	tokenURL     string
	jwksURL      string
}

type session struct {
	Ident   Identity
	Expiry  time.Time
	Refresh string
}

type Authenticator struct {
	mu       sync.RWMutex
	cfg      *oidcConfig
	sessions map[string]*session
	client   *http.Client
}

func NewAuthenticator(issuer, clientID, clientSecret, redirectURL string) (*Authenticator, error) {
	if issuer == "" {
		return &Authenticator{}, nil
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	a := &Authenticator{
		cfg: &oidcConfig{
			issuer:       strings.TrimSuffix(issuer, "/"),
			clientID:     clientID,
			clientSecret: clientSecret,
			redirectURL:  redirectURL,
			signingKey:   key,
		},
		sessions: map[string]*session{},
		client:   &http.Client{Timeout: 15 * time.Second},
	}
	if err := a.discover(); err != nil {
		return nil, err
	}
	return a, nil
}

func (a *Authenticator) Enabled() bool { return a != nil && a.cfg != nil }

func (a *Authenticator) discover() error {
	resp, err := a.client.Get(a.cfg.issuer + "/.well-known/openid-configuration")
	if err != nil {
		return fmt.Errorf("oidc discovery: %w", err)
	}
	defer resp.Body.Close()
	var doc struct {
		AuthURL  string `json:"authorization_endpoint"`
		TokenURL string `json:"token_endpoint"`
		JWKS     string `json:"jwks_uri"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return fmt.Errorf("oidc discovery decode: %w", err)
	}
	if doc.AuthURL == "" || doc.TokenURL == "" {
		return fmt.Errorf("oidc discovery missing endpoints")
	}
	a.cfg.authURL, a.cfg.tokenURL, a.cfg.jwksURL = doc.AuthURL, doc.TokenURL, doc.JWKS
	return nil
}

func sign(value string, key []byte) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (a *Authenticator) newSessionCookie(ident Identity) (*http.Cookie, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	id := base64.RawURLEncoding.EncodeToString(raw)
	a.mu.Lock()
	a.sessions[id] = &session{Ident: ident, Expiry: time.Now().Add(12 * time.Hour)}
	a.mu.Unlock()
	val := id + "." + sign(id, a.cfg.signingKey)
	return &http.Cookie{
		Name:     sessionCookie,
		Value:    val,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int((12 * time.Hour).Seconds()),
	}, nil
}

func (a *Authenticator) sessionFrom(r *http.Request) *session {
	c, err := r.Cookie(sessionCookie)
	if err != nil || !strings.Contains(c.Value, ".") {
		return nil
	}
	parts := strings.SplitN(c.Value, ".", 2)
	if len(parts) != 2 || sign(parts[0], a.cfg.signingKey) != parts[1] {
		return nil
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	s := a.sessions[parts[0]]
	if s == nil || time.Now().After(s.Expiry) {
		return nil
	}
	return s
}

func WithIdentity(ctx context.Context, ident *Identity) context.Context {
	return clusters.WithIdentity(ctx, ident)
}

func IdentityFromContext(ctx context.Context) *Identity {
	return clusters.IdentityFromContext(ctx)
}

func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/auth/") {
			next.ServeHTTP(w, r)
			return
		}
		s := a.sessionFrom(r)
		if s == nil {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.Error(w, `{"error":"login required","login":"/api/auth/login"}`, http.StatusUnauthorized)
				return
			}
			http.Redirect(w, r, "/api/auth/login", http.StatusFound)
			return
		}
		ident := s.Ident
		next.ServeHTTP(w, r.WithContext(WithIdentity(r.Context(), &ident)))
	})
}

func (a *Authenticator) HandleLogin(w http.ResponseWriter, r *http.Request) {
	state := make([]byte, 16)
	_, _ = rand.Read(state)
	url := fmt.Sprintf("%s?client_id=%s&response_type=code&scope=%s&redirect_uri=%s&state=%s",
		a.cfg.authURL,
		queryEscape(a.cfg.clientID),
		queryEscape("openid email groups"),
		queryEscape(a.cfg.redirectURL),
		queryEscape(base64.RawURLEncoding.EncodeToString(state)),
	)
	http.Redirect(w, r, url, http.StatusFound)
}

func queryEscape(s string) string { return strings.ReplaceAll(urlEscape(s), "+", "%20") }

func urlEscape(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func (a *Authenticator) HandleCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "missing code", http.StatusBadRequest)
		return
	}
	form := strings.NewReader(fmt.Sprintf(
		"grant_type=authorization_code&code=%s&redirect_uri=%s&client_id=%s&client_secret=%s",
		urlEscape(code), urlEscape(a.cfg.redirectURL), urlEscape(a.cfg.clientID), urlEscape(a.cfg.clientSecret),
	))
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodPost, a.cfg.tokenURL, form)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := a.client.Do(req)
	if err != nil {
		http.Error(w, "token exchange: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf("token exchange failed (%d)", resp.StatusCode), http.StatusBadGateway)
		return
	}
	var tok struct {
		IDToken      string `json:"id_token"`
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	_ = json.Unmarshal(body, &tok)

	ident, err := a.claimsFromIDToken(tok.IDToken)
	if err != nil {
		http.Error(w, "id token: "+err.Error(), http.StatusBadGateway)
		return
	}

	cookie, err := a.newSessionCookie(*ident)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, cookie)
	http.Redirect(w, r, "/", http.StatusFound)
}

func (a *Authenticator) claimsFromIDToken(token string) (*Identity, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("malformed id_token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decode payload: %w", err)
	}
	var claims struct {
		Email             string      `json:"email"`
		PreferredUsername string      `json:"preferred_username"`
		Groups            []string    `json:"groups"`
		Exp               int64       `json:"exp"`
		Iss               string      `json:"iss"`
		Aud               interface{} `json:"aud"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("claims: %w", err)
	}
	if claims.Exp > 0 && time.Now().Unix() > claims.Exp+60 {
		return nil, fmt.Errorf("token expired")
	}
	if claims.Iss != "" && claims.Iss != a.cfg.issuer {
		return nil, fmt.Errorf("issuer mismatch")
	}
	name := claims.Email
	if name == "" {
		name = claims.PreferredUsername
	}
	if name == "" {
		return nil, fmt.Errorf("no email/preferred_username claim")
	}
	return &Identity{Name: name, Groups: claims.Groups}, nil
}

func (a *Authenticator) HandleMe(w http.ResponseWriter, r *http.Request) {
	ident := IdentityFromContext(r.Context())
	if ident == nil {
		writeJSON(w, map[string]any{"authenticated": false})
		return
	}
	writeJSON(w, map[string]any{"authenticated": true, "user": ident.Name, "groups": ident.Groups})
}

func (a *Authenticator) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && strings.Contains(c.Value, ".") {
		id := strings.SplitN(c.Value, ".", 2)[0]
		a.mu.Lock()
		delete(a.sessions, id)
		a.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	http.Redirect(w, r, "/", http.StatusFound)
}
