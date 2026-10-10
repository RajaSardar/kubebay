package clusters

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

const settingsDirName = ".kubebay"

type Identity struct {
	Name   string
	Groups []string
}

type Status string

const (
	// StatusReachable is the /version probe succeeding. It says nothing about
	// whether the user connected (Cluster.Connected).
	StatusReachable   Status = "reachable"
	StatusUnreachable Status = "unreachable"
	// StatusMisconfigured marks a context that exists in the kubeconfig but
	// whose client config could not be built (bad auth provider, missing file,
	// ...).  It is listed so the user can see why, but it has no rest.Config
	// and can never be selected or connected to.
	StatusMisconfigured Status = "misconfigured"
	// StatusChecking is a context that has not been probed yet: neither
	// reachable nor unreachable is known, so the UI must not claim either.
	StatusChecking Status = "checking"
)

type Cluster struct {
	ID      string `json:"id"`
	Context string `json:"context"`
	Server  string `json:"server"`
	Status  Status `json:"status"`
	Version string `json:"version,omitempty"`
	Error   string `json:"error,omitempty"`
	// CheckedAt is when the reachability probe last finished.
	CheckedAt *time.Time `json:"checkedAt,omitempty"`
	// Connected is the user's session state (streams open), not reachability.
	Connected bool `json:"connected"`
}

type entry struct {
	cluster        *Cluster
	cfg            *rest.Config
	kubeconfigPath string
	// legacyExec: the kubeconfig's exec plugin was configured for v1alpha1 and
	// is being asked for v1beta1 (UpgradeLegacyExec).
	legacyExec bool
}

func (m *Manager) HelmEnv(id string) (contextName string, kubeconfigPath string, err error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	e, ok := m.entries[id]
	if !ok {
		return "", "", fmt.Errorf("unknown cluster %q", id)
	}
	ctxName := e.cluster.Context
	joined := e.kubeconfigPath
	// e.kubeconfigPath is the colon-separated list of all kubeconfig files used
	// during load. Helm's --kubeconfig flag only accepts a single file path, so
	// we search for the specific file that actually owns this context.
	if strings.Contains(joined, string(os.PathListSeparator)) {
		for _, p := range strings.Split(joined, string(os.PathListSeparator)) {
			if p == "" {
				continue
			}
			raw, lerr := clientcmd.LoadFromFile(p)
			if lerr != nil {
				continue
			}
			if _, ok := raw.Contexts[ctxName]; ok {
				return ctxName, p, nil
			}
		}
	}
	return ctxName, joined, nil
}

type Manager struct {
	log        *slog.Logger
	mu         sync.RWMutex
	entries    map[string]*entry
	order      []string
	watcher    *fsnotify.Watcher
	kubeconfig string
	extraPaths []string
	isolated   bool
	firstLoad  bool

	// connected holds the clusters the user has connected to this run.
	// Reachability (Status) is probed for every context; connection is the
	// user's choice, and Disconnect tears down what it opened.
	connected       map[string]bool
	disconnectHooks []func(id string)
	// configHooks run after a reload for clusters whose server or credentials
	// changed, so cached clients built from the old config can be rebuilt.
	configHooks []func(id string)
	// watched holds the kubeconfig files the watcher reacts to. Their parent
	// directories are what is watched, so an atomic save (write a temp file,
	// rename it over the original) is still seen.
	watched map[string]bool
	// kick asks the health loop to probe now (after a load) instead of
	// waiting out its interval.
	kick chan struct{}
}

func NewManager(log *slog.Logger, kubeconfigPath string) (*Manager, error) {
	return newManager(log, kubeconfigPath, true)
}

// newManager is NewManager without the file watcher and health loop when
// loops is false, so tests drive probes themselves.
func newManager(log *slog.Logger, kubeconfigPath string, loops bool) (*Manager, error) {
	// KUBEBAY_KUBECONFIG is a prod-safety override: when set it is the ONLY
	// kubeconfig the engine will ever load, regardless of --kubeconfig flag,
	// KUBECONFIG env, or the default ~/.kube/config.  This prevents dev/test
	// runs from accidentally hitting production clusters.
	if override := os.Getenv("KUBEBAY_KUBECONFIG"); override != "" {
		log.Info("KUBEBAY_KUBECONFIG set — using dedicated kubeconfig only", "path", override)
		kubeconfigPath = override
	}

	m := &Manager{
		log:        log,
		entries:    map[string]*entry{},
		kubeconfig: kubeconfigPath,
		firstLoad:  true,
		connected:  map[string]bool{},
		kick:       make(chan struct{}, 1),
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	m.watcher = w

	if kubeconfigPath == "" {
		if home, herr := os.UserHomeDir(); herr == nil {
			if sb, serr := os.ReadFile(filepath.Join(home, ".kubebay", "settings.json")); serr == nil {
				var parsed struct {
					ExtraKubeconfigs []string `json:"extraKubeconfigs"`
					OnlyListed       bool     `json:"onlyListedKubeconfigs"`
				}
				if json.Unmarshal(sb, &parsed) == nil {
					m.SetIsolated(parsed.OnlyListed)
					m.extraPaths = parsed.ExtraKubeconfigs
				}
			}
		}
	}

	if err := m.Load(); err != nil {
		return nil, err
	}
	if loops {
		go m.watchFiles()
		go m.healthLoop()
	}
	return m, nil
}

// ActiveKubeconfigs returns the resolved list of kubeconfig file paths that are
// currently being loaded, in precedence order.  This is exposed via the
// /api/settings GET endpoint so the UI can show the user exactly which files
// are active (useful for debugging "why can't I see my clusters").
func (m *Manager) ActiveKubeconfigs() []string {
	m.mu.RLock()
	kc := m.kubeconfig
	isolated := m.isolated
	extra := append([]string{}, m.extraPaths...)
	m.mu.RUnlock()

	if kc != "" {
		return []string{kc}
	}
	if isolated {
		return extra
	}
	r := clientcmd.NewDefaultClientConfigLoadingRules()
	paths := append([]string{}, r.GetLoadingPrecedence()...)
	paths = append(paths, extra...)
	return paths
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

// ExplicitKubeconfig is the one kubeconfig the engine was pinned to
// (KUBEBAY_KUBECONFIG or --kubeconfig), or "" when it uses the default
// rules. A pinned engine loads nothing else, extra kubeconfigs included.
func (m *Manager) ExplicitKubeconfig() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.kubeconfig
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

	names := make([]string, 0, len(raw.Contexts))
	for name := range raw.Contexts {
		names = append(names, name)
	}
	sort.Strings(names)

	m.mu.RLock()
	prev := m.entries
	m.mu.RUnlock()

	ids := assignIDs(names)
	newEntries := map[string]*entry{}
	var order []string
	var changed []string
	for _, name := range names {
		cc := clientcmd.NewNonInteractiveClientConfig(*raw, name, &clientcmd.ConfigOverrides{}, rules)
		cfg, cfgErr := cc.ClientConfig()
		if cfgErr != nil {
			m.log.Warn("unusable context", "context", name, "err", cfgErr)
		}
		legacyExec := UpgradeLegacyExec(cfg)
		if legacyExec {
			m.log.Info("exec plugin configured for v1alpha1; asking it for v1beta1", "context", name)
		}
		server := ""
		if ctxCfg, ok := raw.Contexts[name]; ok && raw.Clusters != nil {
			if cl, ok := raw.Clusters[ctxCfg.Cluster]; ok {
				server = cl.Server
			}
		}
		id := ids[name]
		order = append(order, id)
		if old, ok := prev[id]; ok && old.cfg != nil && !sameClientConfig(old.cfg, cfg) {
			changed = append(changed, id)
		}
		status := StatusChecking
		errStr := ""
		version := ""
		var checkedAt *time.Time
		if cfgErr != nil {
			status = StatusMisconfigured
			errStr = cfgErr.Error()
		} else if old, ok := prev[id]; ok && old.cfg != nil && old.cluster.Server == server && sameClientConfig(old.cfg, cfg) {
			// Same context, server and credentials: keep what the last probe found rather
			// than flashing every cluster back to unknown on each kubeconfig save.
			m.mu.RLock()
			status, version, errStr, checkedAt = old.cluster.Status, old.cluster.Version, old.cluster.Error, old.cluster.CheckedAt
			m.mu.RUnlock()
		}
		newEntries[id] = &entry{
			cfg:        cfg,
			legacyExec: legacyExec,
			// rules.Precedence is only the multi-file search list; it is left
			// empty whenever rules.ExplicitPath is set (e.g. the engine was
			// started with --kubeconfig or KUBEBAY_KUBECONFIG, this repo's
			// recommended way to point at a dedicated kind kubeconfig instead
			// of the default ~/.kube/config). GetLoadingPrecedence() returns
			// the right list either way -- see HelmEnv, the only reader of
			// this field, for what silently breaks otherwise (Helm releases
			// can never load: HelmEnv would report no kubeconfig file at all
			// for this cluster, so actionCfg falls back to the ambient
			// kubeconfig instead of this one).
			kubeconfigPath: strings.Join(rules.GetLoadingPrecedence(), string(os.PathListSeparator)),
			cluster: &Cluster{
				ID:        id,
				Context:   name,
				Server:    server,
				Status:    status,
				Version:   version,
				Error:     errStr,
				CheckedAt: checkedAt,
			},
		}
	}

	m.mu.Lock()
	old := m.entries
	m.entries = newEntries
	m.order = order
	first := m.firstLoad
	m.firstLoad = false
	var removedConnected []string
	for id := range old {
		if _, ok := newEntries[id]; ok {
			continue
		}
		if !first {
			m.log.Info("cluster removed", "cluster", id)
		}
		if m.connected[id] {
			delete(m.connected, id)
			removedConnected = append(removedConnected, id)
		}
	}
	hooks := append([]func(string){}, m.disconnectHooks...)
	cfgHooks := append([]func(string){}, m.configHooks...)
	m.mu.Unlock()

	for _, id := range removedConnected {
		for _, h := range hooks {
			h(id)
		}
	}
	for _, id := range changed {
		for _, h := range cfgHooks {
			h(id)
		}
	}
	m.watch(rules.GetLoadingPrecedence())
	select {
	case m.kick <- struct{}{}:
	default:
	}
	return nil
}

// assignIDs maps each context name to a URL-safe cluster ID. A name that is
// already safe keeps itself; one that sanitises onto a taken ID gets the next
// free "-2", "-3"… suffix in sorted-name order, so the mapping is stable.
func assignIDs(sortedNames []string) map[string]string {
	out := make(map[string]string, len(sortedNames))
	taken := map[string]bool{}
	for _, n := range sortedNames {
		if sanitizeID(n) == n {
			out[n], taken[n] = n, true
		}
	}
	for _, n := range sortedNames {
		if _, ok := out[n]; ok {
			continue
		}
		base := sanitizeID(n)
		id := base
		for i := 2; taken[id]; i++ {
			id = fmt.Sprintf("%s-%d", base, i)
		}
		out[n], taken[id] = id, true
	}
	return out
}

// sameClientConfig reports whether two configs reach the same server as the
// same user. Anything else (a rotated token, a new exec plugin, a moved
// endpoint) means clients built from a are stale.
func sameClientConfig(a, b *rest.Config) bool {
	if a == nil || b == nil {
		return a == b
	}
	type identity struct {
		Host, APIPath, BearerToken, BearerTokenFile, Username, Password string
		TLS                                                             rest.TLSClientConfig
		Exec                                                            *clientcmdapi.ExecConfig
		Auth                                                            *clientcmdapi.AuthProviderConfig
		Impersonate                                                     rest.ImpersonationConfig
	}
	of := func(c *rest.Config) identity {
		return identity{c.Host, c.APIPath, c.BearerToken, c.BearerTokenFile, c.Username, c.Password, c.TLSClientConfig, c.ExecProvider, c.AuthProvider, c.Impersonate}
	}
	return reflect.DeepEqual(of(a), of(b))
}

// OnConfigChange registers fn to run after a reload changed a cluster's
// server or credentials.
func (m *Manager) OnConfigChange(fn func(id string)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configHooks = append(m.configHooks, fn)
}

// watch makes the watcher cover files: their directories are added (a file
// watch is lost when an editor renames a new copy over it) and events are
// filtered to these names.
func (m *Manager) watch(files []string) {
	if m.watcher == nil {
		return
	}
	set := make(map[string]bool, len(files))
	for _, f := range files {
		if f == "" {
			continue
		}
		f = filepath.Clean(f)
		set[f] = true
		_ = m.watcher.Add(filepath.Dir(f))
	}
	m.mu.Lock()
	m.watched = set
	m.mu.Unlock()
}

func (m *Manager) isWatched(name string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.watched[filepath.Clean(name)]
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
			if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) != 0 && m.isWatched(ev.Name) {
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

// probe checks one cluster's API server and records the result. The network
// call runs without the lock; only the write is locked, because List copies
// the cluster under the read lock.
func (m *Manager) probe(id string) {
	m.mu.RLock()
	e, ok := m.entries[id]
	var cfg *rest.Config
	legacyExec := false
	if ok {
		cfg, legacyExec = e.cfg, e.legacyExec
	}
	m.mu.RUnlock()
	if cfg == nil {
		return // unknown or misconfigured: nothing to probe, keep the load-time reason
	}
	cfgCopy := *cfg
	cfgCopy.Timeout = 5 * time.Second
	client, err := kubernetes.NewForConfig(&cfgCopy)
	if err != nil {
		m.record(id, StatusUnreachable, "", explainExecError(cfg, legacyExec, err.Error()))
		return
	}
	v, err := client.Discovery().ServerVersion()
	if err != nil {
		m.record(id, StatusUnreachable, "", explainExecError(cfg, legacyExec, err.Error()))
		return
	}
	m.record(id, StatusReachable, v.GitVersion, "")
}

// record stores a probe result on the current entry for id, if it still exists.
func (m *Manager) record(id string, status Status, version, errStr string) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[id]
	if !ok || e.cfg == nil {
		return
	}
	e.cluster.Status = status
	if version != "" {
		e.cluster.Version = version
	}
	e.cluster.Error = errStr
	e.cluster.CheckedAt = &now
}

func (m *Manager) healthLoop() {
	for {
		m.mu.RLock()
		ids := make([]string, 0, len(m.entries))
		for id, e := range m.entries {
			if e.cfg == nil {
				continue // misconfigured: nothing to probe, keep the load-time reason
			}
			ids = append(ids, id)
		}
		m.mu.RUnlock()
		var wg sync.WaitGroup
		for _, id := range ids {
			wg.Add(1)
			go func(id string) {
				defer wg.Done()
				// Hard cap per-cluster health check so a hung exec credential
				// plugin (e.g. aws/gke token fetcher) can't block the loop.
				done := make(chan struct{}, 1)
				go func() {
					m.probe(id)
					done <- struct{}{}
				}()
				select {
				case <-done:
				case <-time.After(12 * time.Second):
					m.record(id, StatusUnreachable, "", "health check timed out (exec credential plugin may be slow or missing)")
				}
			}(id)
		}
		wg.Wait()
		select {
		case <-time.After(30 * time.Second):
		case <-m.kick:
		}
	}
}

// Connect marks a cluster as connected by the user. Idempotent.
func (m *Manager) Connect(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[id]
	if !ok {
		return fmt.Errorf("unknown cluster %q", id)
	}
	if e.cfg == nil {
		return fmt.Errorf("cluster %q is misconfigured: %s", id, e.cluster.Error)
	}
	m.connected[id] = true
	return nil
}

// Disconnect clears a cluster's connected state and runs the disconnect
// hooks (stop its informers and port-forwards) even if it was not marked
// connected, so a stray stream can always be torn down.
func (m *Manager) Disconnect(id string) error {
	m.mu.Lock()
	if _, ok := m.entries[id]; !ok {
		m.mu.Unlock()
		return fmt.Errorf("unknown cluster %q", id)
	}
	delete(m.connected, id)
	hooks := append([]func(string){}, m.disconnectHooks...)
	m.mu.Unlock()
	for _, h := range hooks {
		h(id)
	}
	return nil
}

// IsConnected reports whether the user connected to id this run.
func (m *Manager) IsConnected(id string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.connected[id]
}

// OnDisconnect registers teardown run after a cluster is disconnected or
// removed from the kubeconfig while connected.
func (m *Manager) OnDisconnect(fn func(id string)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.disconnectHooks = append(m.disconnectHooks, fn)
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
				Status:  StatusChecking,
			},
		},
	}
	m.order = []string{"in-cluster"}
	m.mu.Unlock()
	go func() {
		time.Sleep(time.Second)
		m.probe("in-cluster")
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
			c.Connected = m.connected[id]
			out = append(out, c)
		}
	}
	return out
}

// ContextName returns the kubeconfig context name behind a cluster id.  Unlike
// RestConfig it also answers for StatusMisconfigured entries, whose cfg is nil:
// a shell is exactly what you want when a context will not build a client.
func (m *Manager) ContextName(id string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	e, ok := m.entries[id]
	if !ok {
		return "", fmt.Errorf("unknown cluster %q", id)
	}
	return e.cluster.Context, nil
}

func (m *Manager) RestConfig(id string) (*rest.Config, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	e, ok := m.entries[id]
	if !ok {
		return nil, fmt.Errorf("unknown cluster %q", id)
	}
	if e.cfg == nil {
		return nil, fmt.Errorf("cluster %q is misconfigured: %s", id, e.cluster.Error)
	}
	return e.cfg, nil
}
