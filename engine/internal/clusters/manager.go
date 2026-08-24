package clusters

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

const settingsDirName = ".kubebay"

type Identity struct {
	Name   string
	Groups []string
}

type Status string

const (
	StatusConnected   Status = "connected"
	StatusUnreachable Status = "unreachable"
)

type Cluster struct {
	ID      string `json:"id"`
	Context string `json:"context"`
	Server  string `json:"server"`
	Status  Status `json:"status"`
	Version string `json:"version,omitempty"`
	Error   string `json:"error,omitempty"`
}

type entry struct {
	cluster        *Cluster
	cfg            *rest.Config
	kubeconfigPath string
}

func (m *Manager) HelmEnv(id string) (contextName string, kubeconfigPaths string, err error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	e, ok := m.entries[id]
	if !ok {
		return "", "", fmt.Errorf("unknown cluster %q", id)
	}
	return e.cluster.Context, e.kubeconfigPath, nil
}

type Manager struct {
	log         *slog.Logger
	mu          sync.RWMutex
	entries     map[string]*entry
	order       []string
	watcher     *fsnotify.Watcher
	kubeconfig  string
	extraPaths  []string
	isolated    bool
	firstLoad   bool
}

func NewManager(log *slog.Logger, kubeconfigPath string) (*Manager, error) {
	m := &Manager{log: log, entries: map[string]*entry{}, kubeconfig: kubeconfigPath, firstLoad: true}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	m.watcher = w
	if err := m.Load(); err != nil {
		return nil, err
	}
	go m.watchFiles()
	go m.healthLoop()
	return m, nil
}

// LoadFromSettings reads ~/.kubebay/settings.json, applies isolated mode and
// extra kubeconfig paths, then reloads. Called INSTEAD of Load() when settings exist.
func (m *Manager) LoadFromSettings() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return m.Load()
	}
	b, err := os.ReadFile(filepath.Join(home, ".kubebay", "settings.json"))
	if err != nil {
		return m.Load()
	}
	var parsed struct {
		ExtraKubeconfigs []string `json:"extraKubeconfigs"`
		OnlyListed       bool     `json:"onlyListedKubeconfigs"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return m.Load()
	}
	m.SetIsolated(parsed.OnlyListed)
	if err := m.SetExtraKubeconfigs(parsed.ExtraKubeconfigs); err != nil {
		return m.Load()
	}
	return nil
}

func (m *Manager) loadingRules() *clientcmd.ClientConfigLoadingRules {
	if m.kubeconfig != "" {
		return &clientcmd.ClientConfigLoadingRules{ExplicitPath: m.kubeconfig}
	}
	if m.isolated {
		return &clientcmd.ClientConfigLoadingRules{Precedence: append([]string{}, m.extraPaths...)}
	}
	r := clientcmd.NewDefaultClientConfigLoadingRules()
	r.Precedence = append(r.Precedence, m.extraPaths...)
	return r
}

// SetIsolated when true loads ONLY the explicitly listed extra kubeconfig
// files — the default ~/.kube/config and KUBECONFIG env are ignored.
func (m *Manager) SetIsolated(v bool) {
	m.mu.Lock()
	m.isolated = v
	m.mu.Unlock()
}

func (m *Manager) validateKubeconfigs(paths []string) error {
	for _, p := range paths {
		if _, err := os.ReadFile(p); err != nil {
			return fmt.Errorf("%s: %w", p, err)
		}
		if _, err := clientcmd.LoadFromFile(p); err != nil {
			return fmt.Errorf("%s: not a kubeconfig: %w", p, err)
		}
	}
	return nil
}

// SetExtraKubeconfigs validates and applies additional kubeconfig files,
// then reloads all clusters (file watchers re-register automatically).
func (m *Manager) SetExtraKubeconfigs(paths []string) error {
	if err := m.validateKubeconfigs(paths); err != nil {
		return err
	}
	m.mu.Lock()
	m.extraPaths = paths
	m.mu.Unlock()
	return m.Load()
}

// ApplySavedSettings reads ~/.kubebay/settings.json and applies extras.
func (m *Manager) ApplySavedSettings() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	b, err := os.ReadFile(filepath.Join(home, settingsDirName, "settings.json"))
	if err != nil {
		return nil
	}
	var parsed struct {
		ExtraKubeconfigs []string `json:"extraKubeconfigs"`
		OnlyListed       bool     `json:"onlyListedKubeconfigs"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return err
	}
	m.SetIsolated(parsed.OnlyListed)
	if len(parsed.ExtraKubeconfigs) == 0 {
		return nil
	}
	return m.SetExtraKubeconfigs(parsed.ExtraKubeconfigs)
}

func (m *Manager) Load() error {
	rules := m.loadingRules()
	raw, err := rules.Load()
	if err != nil {
		return fmt.Errorf("load kubeconfig: %w", err)
	}

	newEntries := map[string]*entry{}
	var order []string
	for name := range raw.Contexts {
		cc := clientcmd.NewNonInteractiveClientConfig(*raw, name, &clientcmd.ConfigOverrides{}, rules)
		cfg, err := cc.ClientConfig()
		if err != nil {
			m.log.Warn("skipping unusable context", "context", name, "err", err)
			continue
		}
		server := ""
		if ctxCfg, ok := raw.Contexts[name]; ok && raw.Clusters != nil {
			if cl, ok := raw.Clusters[ctxCfg.Cluster]; ok {
				server = cl.Server
			}
		}
		id := sanitizeID(name)
		order = append(order, id)
		newEntries[id] = &entry{
			cfg:            cfg,
			kubeconfigPath: strings.Join(rules.Precedence, string(os.PathListSeparator)),
			cluster: &Cluster{
				ID:      id,
				Context: name,
				Server:  server,
				Status:  StatusUnreachable,
			},
		}
	}

	m.mu.Lock()
	old := m.entries
	m.entries = newEntries
	m.order = order
	m.mu.Unlock()

	if !m.firstLoad {
		for id := range old {
			if _, ok := newEntries[id]; !ok {
				m.log.Info("cluster removed", "cluster", id)
			}
		}
	}
	for _, f := range rules.Precedence {
		_ = m.watcher.Add(f)
	}
	m.firstLoad = false
	return nil
}

func sanitizeID(name string) string {
	out := make([]rune, 0, len(name))
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			out = append(out, r)
		default:
			out = append(out, '-')
		}
	}
	return string(out)
}

func (m *Manager) watchFiles() {
	debounce := time.NewTimer(time.Hour)
	debounce.Stop()
	for {
		select {
		case ev, ok := <-m.watcher.Events:
			if !ok {
				return
			}
			if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) != 0 {
				debounce.Reset(500 * time.Millisecond)
			}
		case <-debounce.C:
			m.log.Info("kubeconfig changed, reloading")
			if err := m.Load(); err != nil {
				m.log.Error("reload failed", "err", err)
			}
		case err, ok := <-m.watcher.Errors:
			if !ok {
				return
			}
			m.log.Warn("kubeconfig watch error", "err", err)
		}
	}
}

func (m *Manager) healthOnce(e *entry) {
	cfgCopy := *e.cfg
	cfgCopy.Timeout = 5 * time.Second
	client, err := kubernetes.NewForConfig(&cfgCopy)
	if err != nil {
		e.cluster.Status = StatusUnreachable
		e.cluster.Error = err.Error()
		return
	}
	v, err := client.Discovery().ServerVersion()
	if err != nil {
		e.cluster.Status = StatusUnreachable
		e.cluster.Error = err.Error()
		return
	}
	e.cluster.Status = StatusConnected
	e.cluster.Version = v.GitVersion
	e.cluster.Error = ""
}

func (m *Manager) healthLoop() {
	for {
		m.mu.RLock()
		list := make([]*entry, 0, len(m.entries))
		for _, e := range m.entries {
			list = append(list, e)
		}
		m.mu.RUnlock()
		var wg sync.WaitGroup
		for _, e := range list {
			wg.Add(1)
			go func(e *entry) {
				defer wg.Done()
				m.healthOnce(e)
			}(e)
		}
		wg.Wait()
		time.Sleep(30 * time.Second)
	}
}

func (m *Manager) LoadInCluster() error {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		return fmt.Errorf("in-cluster config: %w", err)
	}
	m.mu.Lock()
	m.entries = map[string]*entry{
		"in-cluster": {
			cfg: cfg,
			cluster: &Cluster{
				ID:      "in-cluster",
				Context: "in-cluster",
				Server:  "(in-cluster)",
				Status:  StatusUnreachable,
			},
		},
	}
	m.order = []string{"in-cluster"}
	m.mu.Unlock()
	go func() {
		time.Sleep(time.Second)
		m.mu.RLock()
		e := m.entries["in-cluster"]
		m.mu.RUnlock()
		if e != nil {
			m.healthOnce(e)
		}
	}()
	return nil
}

type ctxKey int

const identityKey ctxKey = 1

func WithIdentity(ctx context.Context, ident *Identity) context.Context {
	return context.WithValue(ctx, identityKey, ident)
}

func IdentityFromContext(ctx context.Context) *Identity {
	v, _ := ctx.Value(identityKey).(*Identity)
	return v
}

// RestConfigWithIdentity returns a copy of the cluster config that
// impersonates the given identity (nil = engine's own identity).
func (m *Manager) RestConfigWithIdentity(id string, ident *Identity) (*rest.Config, error) {
	base, err := m.RestConfig(id)
	if err != nil {
		return nil, err
	}
	if ident == nil || ident.Name == "" {
		return base, nil
	}
	cp := *base
	cp.Impersonate = rest.ImpersonationConfig{
		UserName: ident.Name,
		Groups:   ident.Groups,
	}
	return &cp, nil
}

func (m *Manager) List() []Cluster {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Cluster, 0, len(m.order))
	for _, id := range m.order {
		if e, ok := m.entries[id]; ok {
			c := *e.cluster
			out = append(out, c)
		}
	}
	return out
}

func (m *Manager) RestConfig(id string) (*rest.Config, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	e, ok := m.entries[id]
	if !ok {
		return nil, fmt.Errorf("unknown cluster %q", id)
	}
	return e.cfg, nil
}
