package clusters

import (
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

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
	log        *slog.Logger
	mu         sync.RWMutex
	entries    map[string]*entry
	order      []string
	watcher    *fsnotify.Watcher
	kubeconfig string
}

func NewManager(log *slog.Logger, kubeconfigPath string) (*Manager, error) {
	m := &Manager{log: log, entries: map[string]*entry{}, kubeconfig: kubeconfigPath}
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

func (m *Manager) loadingRules() *clientcmd.ClientConfigLoadingRules {
	r := clientcmd.NewDefaultClientConfigLoadingRules()
	if m.kubeconfig != "" {
		r.ExplicitPath = m.kubeconfig
	}
	return r
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

	for id := range old {
		if _, ok := newEntries[id]; !ok {
			m.log.Info("cluster removed", "cluster", id)
		}
	}
	for _, f := range rules.Precedence {
		_ = m.watcher.Add(f)
	}
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
