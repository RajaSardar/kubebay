package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"k8s.io/client-go/tools/clientcmd"
)

const settingsDir = ".kubebay"

type AppSettings struct {
	// PrometheusURL is the fallback used by any cluster without its own entry.
	// It predates PrometheusURLs and is still honoured so upgrading does not
	// silently drop an existing configuration.
	PrometheusURL    string            `json:"prometheusUrl,omitempty"`
	PrometheusURLs   map[string]string `json:"prometheusUrls,omitempty"`
	ExtraKubeconfigs []string          `json:"extraKubeconfigs,omitempty"`
	OnlyListed       bool              `json:"onlyListedKubeconfigs,omitempty"`
	NodeShellImage   string            `json:"nodeShellImage,omitempty"`
}

// PrometheusURLFor resolves the endpoint to query for one cluster. A
// port-forward to cluster A's Prometheus must never answer for cluster B, so
// callers pass the cluster explicitly rather than reading a process-wide value.
func (a *AppSettings) PrometheusURLFor(cluster string) string {
	if u := a.PrometheusURLs[cluster]; u != "" {
		return u
	}
	return a.PrometheusURL
}

type SettingsManager struct {
	mgr *clusters.Manager
	mu  chan struct{}
}

func NewSettingsManager(mgr *clusters.Manager) *SettingsManager {
	return &SettingsManager{mgr: mgr, mu: make(chan struct{}, 1)}
}

func settingsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, settingsDir, "settings.json"), nil
}

func (s *SettingsManager) Load() (*AppSettings, error) {
	p, err := settingsPath()
	if err != nil {
		return nil, err
	}
	out := &AppSettings{}
	b, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(b, out); err != nil {
		return nil, fmt.Errorf("parse %s: %w", p, err)
	}
	return out, nil
}

func (s *SettingsManager) save(set *AppSettings) error {
	p, err := settingsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(set, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func sanitizePath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", fmt.Errorf("empty path")
	}
	if _, err := os.Stat(p); err != nil {
		return "", fmt.Errorf("file not readable: %w", err)
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return "", err
	}
	if _, err := clientcmdParse(raw); err != nil {
		return "", fmt.Errorf("not a valid kubeconfig: %w", err)
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	return abs, nil
}

func (s *SettingsManager) HandleGet(w http.ResponseWriter, r *http.Request) {
	set, err := s.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{
		"prometheusUrl":         set.PrometheusURL,
		"prometheusUrls":        set.PrometheusURLs,
		"extraKubeconfigs":      set.ExtraKubeconfigs,
		"onlyListedKubeconfigs": set.OnlyListed,
		"activeKubeconfigs":     s.mgr.ActiveKubeconfigs(),
		"nodeShellImage":        set.NodeShellImage,
		"nodeShellImageDefault": DefaultNodeShellImage,
	})
}

func (s *SettingsManager) HandleSave(w http.ResponseWriter, r *http.Request) {
	var incoming struct {
		PrometheusURL    string   `json:"prometheusUrl"`
		ExtraKubeconfigs []string `json:"extraKubeconfigs"`
		OnlyListed       bool     `json:"onlyListedKubeconfigs"`
		// Pointers so an omitted field keeps the stored value: callers that
		// only save Prometheus settings must not wipe the node-shell image.
		NodeShellImage *string            `json:"nodeShellImage"`
		PrometheusURLs *map[string]string `json:"prometheusUrls"`
	}
	if err := decodeBody(r, &incoming); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}

	current, _ := s.Load()
	validated := make([]string, 0, len(incoming.ExtraKubeconfigs))
	for _, p := range incoming.ExtraKubeconfigs {
		abs, err := sanitizePath(p)
		if err != nil {
			http.Error(w, fmt.Sprintf("%s: %v", p, err), http.StatusBadRequest)
			return
		}
		dup := false
		for _, existing := range validated {
			if existing == abs {
				dup = true
				break
			}
		}
		if !dup {
			validated = append(validated, abs)
		}
	}

	nodeShellImage := ""
	var promURLs map[string]string
	if current != nil {
		nodeShellImage = current.NodeShellImage
		promURLs = current.PrometheusURLs
	}
	if incoming.NodeShellImage != nil {
		nodeShellImage = strings.TrimSpace(*incoming.NodeShellImage)
	}
	if incoming.PrometheusURLs != nil {
		promURLs = map[string]string{}
		for cluster, u := range *incoming.PrometheusURLs {
			if u = normalizePromURL(u); u != "" {
				promURLs[cluster] = u
			}
		}
	}

	next := &AppSettings{
		PrometheusURL:    normalizePromURL(incoming.PrometheusURL),
		PrometheusURLs:   promURLs,
		ExtraKubeconfigs: validated,
		OnlyListed:       incoming.OnlyListed,
		NodeShellImage:   nodeShellImage,
	}
	s.mu <- struct{}{}
	defer func() { <-s.mu }()
	if err := s.save(next); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.mgr.SetIsolated(next.OnlyListed)
	if err := s.mgr.SetExtraKubeconfigs(next.ExtraKubeconfigs); err != nil {
		http.Error(w, fmt.Sprintf("reload: %v", err), http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "saved": next})
}

func normalizePromURL(u string) string {
	return strings.TrimRight(strings.TrimSpace(u), "/")
}

func clientcmdParse(raw []byte) (interface{}, error) {
	cfg, err := clientcmd.Load(raw)
	if err != nil {
		return nil, err
	}
	return cfg, nil
}

var (
	_ = context.Background
	_ = rand.Read
)
