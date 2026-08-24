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
	PrometheusURL    string   `json:"prometheusUrl,omitempty"`
	ExtraKubeconfigs []string `json:"extraKubeconfigs,omitempty"`
	OnlyListed       bool     `json:"onlyListedKubeconfigs,omitempty"`
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
		"extraKubeconfigs":      set.ExtraKubeconfigs,
		"onlyListedKubeconfigs": set.OnlyListed,
	})
}

func (s *SettingsManager) HandleSave(w http.ResponseWriter, r *http.Request) {
	var incoming struct {
		PrometheusURL    string   `json:"prometheusUrl"`
		ExtraKubeconfigs []string `json:"extraKubeconfigs"`
		OnlyListed       bool     `json:"onlyListedKubeconfigs"`
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

	next := &AppSettings{
		PrometheusURL:    strings.TrimRight(strings.TrimSpace(incoming.PrometheusURL), "/"),
		ExtraKubeconfigs: validated,
		OnlyListed:       incoming.OnlyListed,
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
	_ = current
	writeJSON(w, map[string]any{"ok": true, "saved": next})
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
