package rolloutsdash

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/redact"
)

// State is where one cluster's dashboard is.
type State string

const (
	StateStopped      State = "stopped"
	StateStarting     State = "starting"
	StateRunning      State = "running"
	StateFailed       State = "failed"
	StateNotInstalled State = "not-installed"
)

// DefaultPrefix is where the same-origin proxy mounts a run: <prefix><token>/.
const DefaultPrefix = "/api/rollouts-dashboard/"

// ErrCapReached is returned when starting would exceed MaxTotal dashboards.
var ErrCapReached = errors.New("three Argo dashboards are already running; close another one first")

// Status is what the UI sees.
type Status struct {
	State      State  `json:"state"`
	URL        string `json:"url,omitempty"`
	Message    string `json:"message,omitempty"`
	StderrTail string `json:"stderrTail,omitempty"`
	Install    *Help  `json:"install,omitempty"`
}

// Manager owns every dashboard process: at most one per cluster and MaxTotal
// overall. Fields are set before first use.
type Manager struct {
	// Locate returns the plugin's path, or "" when it is not installed.
	Locate func() string
	// Kubeconfig returns the single kubeconfig file that defines the cluster's
	// context, and that context's name.
	Kubeconfig func(cluster string) (file, context string, err error)
	// Env is the parent environment (os.Environ); only a few names are kept.
	Env func() []string
	// DataDir holds the pid file the orphan sweep reads; "" disables it.
	DataDir string

	Prefix           string        // DefaultPrefix
	MaxTotal         int           // 3
	HealthTimeout    time.Duration // 15s
	PollEvery        time.Duration // 100ms
	IdleAfterRelease time.Duration // 60s: UI left the tab
	HeartbeatExpiry  time.Duration // 3m: UI stopped sending heartbeats
	StopGrace        time.Duration // 3s between SIGTERM and SIGKILL

	mu     sync.Mutex
	runs   map[string]*run
	failed map[string]Status
	help   map[string]helpEntry
}

type helpEntry struct {
	mod time.Time
	ok  bool
}

type timerKind int

const (
	kindHeartbeat timerKind = iota
	kindIdle
)

type run struct {
	cluster string
	token   string
	port    int
	cmd     *exec.Cmd
	pid     int
	state   State
	tail    *tailBuf
	exited  chan struct{}

	timer    *time.Timer
	kind     timerKind
	conns    int
	stopping bool
}

func (m *Manager) prefix() string {
	if m.Prefix == "" {
		return DefaultPrefix
	}
	return m.Prefix
}

func dur(v, def time.Duration) time.Duration {
	if v <= 0 {
		return def
	}
	return v
}

func (m *Manager) maxTotal() int {
	if m.MaxTotal <= 0 {
		return 3
	}
	return m.MaxTotal
}

func (m *Manager) init() {
	if m.runs == nil {
		m.runs = map[string]*run{}
		m.failed = map[string]Status{}
		m.help = map[string]helpEntry{}
	}
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (m *Manager) statusOf(r *run) Status {
	st := Status{State: r.state}
	if r.state == StateRunning {
		st.URL = m.prefix() + r.token + "/"
	}
	return st
}

// Status reports a cluster's dashboard without starting anything.
func (m *Manager) Status(cluster string) Status {
	m.mu.Lock()
	m.init()
	if r := m.runs[cluster]; r != nil {
		st := m.statusOf(r)
		m.mu.Unlock()
		return st
	}
	if st, ok := m.failed[cluster]; ok {
		m.mu.Unlock()
		return st
	}
	m.mu.Unlock()
	if m.Locate == nil || m.Locate() == "" {
		h := InstallHelp()
		return Status{State: StateNotInstalled, Install: &h}
	}
	return Status{State: StateStopped}
}

// Start makes the cluster's dashboard run and returns once it answers (or has
// failed). A second call while one runs or starts returns that run: one per
// cluster, so a double click cannot spawn two.
func (m *Manager) Start(ctx context.Context, cluster string, namespaces []string) (Status, error) {
	m.mu.Lock()
	m.init()
	if r := m.runs[cluster]; r != nil {
		if r.state == StateRunning {
			m.arm(r, kindHeartbeat)
		}
		st := m.statusOf(r)
		m.mu.Unlock()
		return st, nil
	}
	m.mu.Unlock()

	bin := ""
	if m.Locate != nil {
		bin = m.Locate()
	}
	if bin == "" {
		h := InstallHelp()
		return Status{State: StateNotInstalled, Install: &h}, nil
	}
	kubeconfig, ctxName, err := m.Kubeconfig(cluster)
	if err != nil {
		return m.fail(cluster, nil, "could not find this cluster's kubeconfig: "+err.Error()), nil
	}
	if _, err := BuildArgv(ArgvOptions{Kubeconfig: kubeconfig, Context: ctxName, Namespaces: namespaces, Port: 1, RootPath: "/x"}); err != nil {
		return m.fail(cluster, nil, err.Error()), nil
	}
	env := BuildEnv(m.parentEnv(), kubeconfig, filepath.Dir(bin))
	if !m.supportsRootPath(ctx, bin, env) {
		return m.fail(cluster, nil, "this kubectl-argo-rollouts is too old to be shown inside Kubebay (its dashboard has no --root-path); upgrade it and try again"), nil
	}
	token, err := newToken()
	if err != nil {
		return Status{}, err
	}

	r := &run{cluster: cluster, token: token, state: StateStarting, tail: &tailBuf{max: 2048}}
	m.mu.Lock()
	if cur := m.runs[cluster]; cur != nil {
		st := m.statusOf(cur)
		m.mu.Unlock()
		return st, nil
	}
	if len(m.runs) >= m.maxTotal() {
		m.mu.Unlock()
		return Status{}, ErrCapReached
	}
	m.runs[cluster] = r
	delete(m.failed, cluster)
	m.mu.Unlock()

	var lastErr string
	for attempt := 0; attempt < 2; attempt++ {
		retry, msg := m.launch(ctx, r, bin, env, kubeconfig, ctxName, namespaces)
		if msg == "" {
			return m.Status(cluster), nil
		}
		lastErr = msg
		if !retry {
			break
		}
	}
	m.drop(r)
	return m.fail(cluster, r.tail, lastErr), nil
}

func (m *Manager) parentEnv() []string {
	if m.Env != nil {
		return m.Env()
	}
	return os.Environ()
}

func (m *Manager) fail(cluster string, tail *tailBuf, msg string) Status {
	st := Status{State: StateFailed, Message: msg}
	if tail != nil {
		st.StderrTail = tail.String()
	}
	m.mu.Lock()
	m.init()
	m.failed[cluster] = st
	m.mu.Unlock()
	return st
}

// supportsRootPath asks the plugin's own help; cached per binary and mtime.
func (m *Manager) supportsRootPath(ctx context.Context, bin string, env []string) bool {
	fi, err := os.Stat(bin)
	if err != nil {
		return false
	}
	m.mu.Lock()
	m.init()
	if e, ok := m.help[bin]; ok && e.mod.Equal(fi.ModTime()) {
		m.mu.Unlock()
		return e.ok
	}
	m.mu.Unlock()
	hctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(hctx, bin, "dashboard", "--help")
	cmd.Env = env
	out, _ := cmd.CombinedOutput()
	ok := strings.Contains(string(out), "--root-path")
	if hctx.Err() == nil {
		m.mu.Lock()
		m.help[bin] = helpEntry{mod: fi.ModTime(), ok: ok}
		m.mu.Unlock()
	}
	return ok
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// launch starts the plugin once and waits for it to answer. It returns
// retry=true when the child exited before answering (a lost port race).
func (m *Manager) launch(ctx context.Context, r *run, bin string, env []string, kubeconfig, ctxName string, namespaces []string) (retry bool, msg string) {
	port, err := freePort()
	if err != nil {
		return false, "no free loopback port: " + err.Error()
	}
	root := m.prefix() + r.token
	args, err := BuildArgv(ArgvOptions{Kubeconfig: kubeconfig, Context: ctxName, Namespaces: namespaces, Port: port, RootPath: root})
	if err != nil {
		return false, err.Error()
	}
	cmd := exec.Command(bin, args...)
	cmd.Env = env
	cmd.Stdout, cmd.Stderr = r.tail, r.tail
	inOwnGroup(cmd)
	if err := cmd.Start(); err != nil {
		return false, "could not start kubectl-argo-rollouts: " + err.Error()
	}
	exited := make(chan struct{})
	m.mu.Lock()
	r.cmd, r.pid, r.port, r.exited = cmd, cmd.Process.Pid, port, exited
	m.mu.Unlock()
	m.recordPID(r.pid, ident(r.pid))
	go func() {
		_ = cmd.Wait()
		close(exited)
		m.onExit(r)
	}()

	hc := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}}
	url := fmt.Sprintf("http://127.0.0.1:%d%s/", port, root)
	deadline := time.Now().Add(dur(m.HealthTimeout, 15*time.Second))
	poll := dur(m.PollEvery, 100*time.Millisecond)
	for {
		select {
		case <-exited:
			m.removePID(r.pid)
			return true, "kubectl-argo-rollouts exited before the dashboard answered"
		case <-ctx.Done():
			m.killRun(r)
			return false, "start cancelled"
		default:
		}
		if resp, err := hc.Get(url); err == nil {
			ok := resp.StatusCode == http.StatusOK && strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html")
			_ = resp.Body.Close()
			// The child must still be ours and alive: a squatter that took the
			// port while the plugin failed to bind must not be shown.
			select {
			case <-exited:
				return true, "kubectl-argo-rollouts exited before the dashboard answered"
			default:
			}
			if ok {
				m.mu.Lock()
				r.state = StateRunning
				m.arm(r, kindHeartbeat)
				m.mu.Unlock()
				return false, ""
			}
		}
		if time.Now().After(deadline) {
			m.killRun(r)
			return false, fmt.Sprintf("the dashboard did not answer within %s", dur(m.HealthTimeout, 15*time.Second))
		}
		time.Sleep(poll)
	}
}

// arm (re)starts the run's timer. Callers hold m.mu.
func (m *Manager) arm(r *run, kind timerKind) {
	d := dur(m.HeartbeatExpiry, 3*time.Minute)
	if kind == kindIdle {
		d = dur(m.IdleAfterRelease, 60*time.Second)
	}
	r.kind = kind
	if r.timer != nil {
		r.timer.Stop()
	}
	r.timer = time.AfterFunc(d, func() { m.timerFired(r) })
}

func (m *Manager) timerFired(r *run) {
	m.mu.Lock()
	if m.runs[r.cluster] != r || r.stopping {
		m.mu.Unlock()
		return
	}
	if r.kind == kindHeartbeat && r.conns > 0 {
		// An open stream is a live client, even if the webview throttled its timers.
		m.arm(r, kindHeartbeat)
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()
	m.stop(r)
}

// Heartbeat tells the manager the UI still has the tab open.
func (m *Manager) Heartbeat(cluster string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	r := m.runs[cluster]
	if r == nil || r.state != StateRunning {
		return false
	}
	m.arm(r, kindHeartbeat)
	return true
}

// Release says the UI left the tab; the dashboard stops after IdleAfterRelease
// unless it is reopened first.
func (m *Manager) Release(cluster string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	if r := m.runs[cluster]; r != nil && r.state == StateRunning {
		m.arm(r, kindIdle)
	}
}

// StopCluster ends a cluster's dashboard (the cluster disconnected).
func (m *Manager) StopCluster(cluster string) {
	m.mu.Lock()
	m.init()
	r := m.runs[cluster]
	delete(m.failed, cluster)
	m.mu.Unlock()
	if r != nil {
		m.stop(r)
	}
}

// StopAll ends every dashboard (the app is quitting).
func (m *Manager) StopAll() {
	m.mu.Lock()
	m.init()
	var rs []*run
	for _, r := range m.runs {
		rs = append(rs, r)
	}
	m.mu.Unlock()
	var wg sync.WaitGroup
	for _, r := range rs {
		wg.Add(1)
		go func() { defer wg.Done(); m.stop(r) }()
	}
	wg.Wait()
}

// drop removes a run that never became healthy.
func (m *Manager) drop(r *run) {
	m.mu.Lock()
	if m.runs[r.cluster] == r {
		delete(m.runs, r.cluster)
	}
	if r.timer != nil {
		r.timer.Stop()
	}
	m.mu.Unlock()
}

func (m *Manager) stop(r *run) {
	m.mu.Lock()
	if r.stopping {
		m.mu.Unlock()
		return
	}
	r.stopping = true
	if m.runs[r.cluster] == r {
		delete(m.runs, r.cluster)
	}
	if r.timer != nil {
		r.timer.Stop()
	}
	m.mu.Unlock()
	m.killRun(r)
}

// killRun ends the child's whole group: polite first, then forced.
func (m *Manager) killRun(r *run) {
	m.mu.Lock()
	pid, exited := r.pid, r.exited
	m.mu.Unlock()
	if pid == 0 || exited == nil {
		return
	}
	terminateGroup(pid)
	select {
	case <-exited:
	case <-time.After(dur(m.StopGrace, 3*time.Second)):
		killGroup(pid)
		<-exited
	}
	// A helper the plugin forked may outlive it; the group goes regardless.
	killGroup(pid)
	m.removePID(pid)
}

func (m *Manager) onExit(r *run) {
	m.mu.Lock()
	if r.stopping || m.runs[r.cluster] != r || r.state != StateRunning {
		m.mu.Unlock()
		return
	}
	delete(m.runs, r.cluster)
	if r.timer != nil {
		r.timer.Stop()
	}
	m.failed[r.cluster] = Status{State: StateFailed, Message: "kubectl-argo-rollouts stopped unexpectedly", StderrTail: r.tail.String()}
	m.mu.Unlock()
	killGroup(r.pid)
	m.removePID(r.pid)
}

// Acquire finds the running dashboard for a proxy path token, comparing in
// constant time, and counts the caller as a live client until release is called.
func (m *Manager) Acquire(token string) (port int, release func(), ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var found *run
	for _, r := range m.runs {
		if subtle.ConstantTimeCompare([]byte(r.token), []byte(token)) == 1 && r.state == StateRunning {
			found = r
		}
	}
	if found == nil {
		return 0, nil, false
	}
	found.conns++
	var once sync.Once
	return found.port, func() { once.Do(func() { m.mu.Lock(); found.conns--; m.mu.Unlock() }) }, true
}

// tailBuf keeps the last max bytes written to it.
type tailBuf struct {
	mu  sync.Mutex
	buf []byte
	max int
}

func (t *tailBuf) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > t.max {
		t.buf = t.buf[len(t.buf)-t.max:]
	}
	return len(p), nil
}

// String is the tail with secret-looking values redacted.
func (t *tailBuf) String() string {
	t.mu.Lock()
	s := string(t.buf)
	t.mu.Unlock()
	s, _ = redact.String(s)
	return strings.TrimSpace(s)
}
