package rolloutsdash

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The fake plugin is this test binary re-executed through a shell script, so
// it needs no network, no cluster and no real kubectl-argo-rollouts.
//
// Modes: ok, noflag (help lacks --root-path), nobind (exits as if the port was
// taken), noanswer (never listens), exitlater (serves, then dies), fork (ok
// plus a forked child in the same process group).

type record struct {
	Args []string `json:"args"`
	Env  []string `json:"env"`
}

func TestFakePluginHelper(t *testing.T) {
	if os.Getenv("FAKE_PLUGIN") != "1" {
		return
	}
	args := os.Args
	for i, a := range args {
		if a == "--" {
			args = args[i+1:]
			break
		}
	}
	mode := os.Getenv("FAKE_MODE")
	if len(args) >= 2 && args[1] == "--help" {
		fmt.Println("Usage: dashboard\n  --port int\n  --kubeconfig string")
		if mode != "noflag" {
			fmt.Println("  --root-path string")
		}
		os.Exit(0)
	}
	b, _ := json.Marshal(record{Args: args, Env: os.Environ()})
	_ = os.WriteFile(os.Getenv("FAKE_RECORD"), b, 0o600)
	var port, root string
	for i, a := range args {
		if a == "--port" {
			port = args[i+1]
		}
		if a == "--root-path" {
			root = args[i+1]
		}
	}
	switch mode {
	case "nobind":
		fmt.Fprintln(os.Stderr, "listen tcp 127.0.0.1:"+port+": bind: address already in use")
		os.Exit(1)
	case "noanswer":
		fmt.Fprintln(os.Stderr, "waiting for the cluster, token=abcdef0123456789abcdef0123456789abcdef01")
		time.Sleep(time.Hour)
	case "fork":
		c := exec.Command("sleep", "300")
		_ = c.Start()
		_ = os.WriteFile(os.Getenv("FAKE_RECORD")+".child", []byte(strconv.Itoa(c.Process.Pid)), 0o600)
	}
	mux := http.NewServeMux()
	mux.HandleFunc(root+"/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html>fake dashboard</html>"))
	})
	if mode == "exitlater" {
		go func() {
			time.Sleep(700 * time.Millisecond)
			fmt.Fprintln(os.Stderr, "fatal: lost the cluster")
			os.Exit(3)
		}()
	}
	l, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	_ = http.Serve(l, mux)
}

type fake struct {
	bin, record string
}

func newFake(t *testing.T, mode string) fake {
	t.Helper()
	dir := t.TempDir()
	rec := filepath.Join(dir, "record.json")
	bin := filepath.Join(dir, PluginName)
	self, _ := os.Executable()
	script := fmt.Sprintf("#!/bin/sh\nFAKE_PLUGIN=1 FAKE_MODE=%s FAKE_RECORD=%s exec %s -test.run=^TestFakePluginHelper$ -- \"$@\"\n", mode, rec, self)
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return fake{bin: bin, record: rec}
}

func (f fake) recorded(t *testing.T) record {
	t.Helper()
	var r record
	b, err := os.ReadFile(f.record)
	if err != nil {
		t.Fatalf("plugin never ran: %v", err)
	}
	_ = json.Unmarshal(b, &r)
	return r
}

func newManager(t *testing.T, f fake) *Manager {
	t.Helper()
	m := &Manager{
		Locate:     func() string { return f.bin },
		Kubeconfig: func(c string) (string, string, error) { return "/kc/" + c, "ctx-" + c, nil },
		Env: func() []string {
			return []string{"HOME=/h", "PATH=/usr/bin:/bin", "KUBEBAY_TOKEN=nope", "KUBECONFIG=/other"}
		},
		DataDir:          t.TempDir(),
		HealthTimeout:    5 * time.Second,
		PollEvery:        20 * time.Millisecond,
		IdleAfterRelease: 150 * time.Millisecond,
		HeartbeatExpiry:  400 * time.Millisecond,
		StopGrace:        time.Second,
	}
	t.Cleanup(m.StopAll)
	return m
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func gone(pid int) bool { return !pidAlive(pid) }

func (m *Manager) pidOf(cluster string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r := m.runs[cluster]; r != nil {
		return r.pid
	}
	return 0
}

func get(t *testing.T, url string) (int, string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		return 0, err.Error()
	}
	defer resp.Body.Close()
	buf := make([]byte, 64)
	n, _ := resp.Body.Read(buf)
	return resp.StatusCode, string(buf[:n])
}

func portOf(m *Manager, c string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.runs[c].port
}

func TestStartRunsPluginWithArgvAndScrubbedEnv(t *testing.T) {
	f := newFake(t, "ok")
	m := newManager(t, f)
	st, err := m.Start(context.Background(), "dev", []string{"shop"})
	if err != nil || st.State != StateRunning {
		t.Fatalf("start: %+v %v", st, err)
	}
	if !strings.HasPrefix(st.URL, DefaultPrefix) || !strings.HasSuffix(st.URL, "/") {
		t.Fatalf("url %q", st.URL)
	}
	token := strings.TrimSuffix(strings.TrimPrefix(st.URL, DefaultPrefix), "/")
	if len(token) < 43 { // 32 bytes, base64url
		t.Fatalf("token too short: %q", token)
	}
	rec := f.recorded(t)
	joined := strings.Join(rec.Args, " ")
	for _, want := range []string{"dashboard --kubeconfig /kc/dev --context ctx-dev --namespace shop --port", "--root-path " + DefaultPrefix + token} {
		if !strings.Contains(joined, want) {
			t.Errorf("argv %q lacks %q", joined, want)
		}
	}
	envs := strings.Join(rec.Env, "\n")
	if strings.Contains(envs, "KUBEBAY_") || strings.Contains(envs, "/other") {
		t.Errorf("env leaked: %s", envs)
	}
	if !strings.Contains(envs, "KUBECONFIG=/kc/dev\n") && !strings.HasSuffix(envs, "KUBECONFIG=/kc/dev") && !strings.Contains(envs, "KUBECONFIG=/kc/dev") {
		t.Errorf("KUBECONFIG not the dedicated file: %s", envs)
	}
	// The page answers through the loopback port under the token path.
	if code, body := get(t, fmt.Sprintf("http://127.0.0.1:%d%s", portOf(m, "dev"), st.URL)); code != 200 || !strings.Contains(body, "fake dashboard") {
		t.Fatalf("upstream: %d %q", code, body)
	}
}

func TestStartIsReusedPerCluster(t *testing.T) {
	m := newManager(t, newFake(t, "ok"))
	a, _ := m.Start(context.Background(), "dev", nil)
	pid := m.pidOf("dev")
	b, _ := m.Start(context.Background(), "dev", nil)
	if a.URL != b.URL || m.pidOf("dev") != pid {
		t.Fatalf("second start spawned another process: %q vs %q", a.URL, b.URL)
	}
}

func TestConcurrentStartsSpawnOneProcess(t *testing.T) {
	m := newManager(t, newFake(t, "ok"))
	res := make(chan Status, 6)
	for i := 0; i < 6; i++ {
		go func() { st, _ := m.Start(context.Background(), "dev", nil); res <- st }()
	}
	for i := 0; i < 6; i++ {
		<-res
	}
	m.mu.Lock()
	n := len(m.runs)
	m.mu.Unlock()
	if n != 1 {
		t.Fatalf("runs: %d", n)
	}
}

func TestCapOfThreeOverall(t *testing.T) {
	m := newManager(t, newFake(t, "ok"))
	for _, c := range []string{"a", "b", "c"} {
		if st, err := m.Start(context.Background(), c, nil); err != nil || st.State != StateRunning {
			t.Fatalf("%s: %+v %v", c, st, err)
		}
	}
	if _, err := m.Start(context.Background(), "d", nil); err != ErrCapReached {
		t.Fatalf("fourth start: %v", err)
	}
	// An existing one is still reusable at the cap.
	if st, err := m.Start(context.Background(), "a", nil); err != nil || st.State != StateRunning {
		t.Fatalf("reuse at cap: %+v %v", st, err)
	}
}

func TestIdleStopAfterReleaseAndReopenCancelsIt(t *testing.T) {
	m := newManager(t, newFake(t, "ok"))
	_, _ = m.Start(context.Background(), "dev", nil)
	pid := m.pidOf("dev")
	m.Release("dev")
	time.Sleep(60 * time.Millisecond)
	if _, err := m.Start(context.Background(), "dev", nil); err != nil { // reopen
		t.Fatal(err)
	}
	m.Heartbeat("dev")
	time.Sleep(200 * time.Millisecond) // past the idle window
	if m.pidOf("dev") != pid || gone(pid) {
		t.Fatal("reopening must cancel the idle stop and reuse the process")
	}
	m.Release("dev")
	waitFor(t, "idle stop", func() bool { return gone(pid) })
	if st := m.Status("dev"); st.State != StateStopped {
		t.Fatalf("after idle stop: %+v", st)
	}
}

func TestMissedHeartbeatsStopTheDashboardButAnOpenStreamKeepsIt(t *testing.T) {
	m := newManager(t, newFake(t, "ok"))
	st, _ := m.Start(context.Background(), "dev", nil)
	pid := m.pidOf("dev")
	token := strings.TrimSuffix(strings.TrimPrefix(st.URL, DefaultPrefix), "/")
	_, release, ok := m.Acquire(token)
	if !ok {
		t.Fatal("acquire")
	}
	time.Sleep(900 * time.Millisecond) // > 2 expiries
	if gone(pid) {
		t.Fatal("an open stream counts as a live client")
	}
	release()
	waitFor(t, "heartbeat expiry", func() bool { return gone(pid) })
}

func TestStopClusterStopAllAndNoOrphans(t *testing.T) {
	f := newFake(t, "fork")
	m := newManager(t, f)
	_, _ = m.Start(context.Background(), "dev", nil)
	pid := m.pidOf("dev")
	var child int
	waitFor(t, "forked child", func() bool {
		b, err := os.ReadFile(f.record + ".child")
		if err != nil {
			return false
		}
		child, _ = strconv.Atoi(string(b))
		return child > 0
	})
	m.StopCluster("dev")
	if !gone(pid) {
		t.Fatal("plugin still alive after cluster disconnect")
	}
	waitFor(t, "forked child gone", func() bool { return gone(child) })

	f2 := newFake(t, "ok")
	m2 := newManager(t, f2)
	_, _ = m2.Start(context.Background(), "a", nil)
	_, _ = m2.Start(context.Background(), "b", nil)
	pa, pb := m2.pidOf("a"), m2.pidOf("b")
	m2.StopAll()
	if !gone(pa) || !gone(pb) {
		t.Fatal("StopAll left a dashboard running")
	}
	if len(m2.readPIDs()) != 0 {
		t.Fatalf("pid file not cleaned: %v", m2.readPIDs())
	}
}

func TestUnexpectedExitFreesTheSlotAndReportsStderr(t *testing.T) {
	m := newManager(t, newFake(t, "exitlater"))
	m.HeartbeatExpiry = time.Minute
	if st, _ := m.Start(context.Background(), "dev", nil); st.State != StateRunning {
		t.Fatalf("start: %+v", st)
	}
	waitFor(t, "failed state", func() bool { return m.Status("dev").State == StateFailed })
	st := m.Status("dev")
	if !strings.Contains(st.StderrTail, "lost the cluster") {
		t.Fatalf("tail: %+v", st)
	}
	m.mu.Lock()
	n := len(m.runs)
	m.mu.Unlock()
	if n != 0 {
		t.Fatal("slot not freed")
	}
}

func TestHealthTimeoutKillsAndShowsRedactedStderrTail(t *testing.T) {
	m := newManager(t, newFake(t, "noanswer"))
	m.HealthTimeout = 400 * time.Millisecond
	st, err := m.Start(context.Background(), "dev", nil)
	if err != nil || st.State != StateFailed {
		t.Fatalf("start: %+v %v", st, err)
	}
	if !strings.Contains(st.Message, "did not answer") || !strings.Contains(st.StderrTail, "waiting for the cluster") {
		t.Fatalf("message/tail: %+v", st)
	}
	if strings.Contains(st.StderrTail, "abcdef0123456789abcdef0123456789abcdef01") {
		t.Fatalf("secret in tail: %q", st.StderrTail)
	}
	m.mu.Lock()
	n := len(m.runs)
	m.mu.Unlock()
	if n != 0 {
		t.Fatal("failed run kept its slot")
	}
}

func TestLostPortRaceFailsInsteadOfShowingTheSquatter(t *testing.T) {
	// A squatter answers 200 text/html on every port the manager might pick is
	// not possible, so squat the one port the plugin is given: the fake exits
	// ("address already in use") and the manager must say failed, not running,
	// even if something else answers there.
	m := newManager(t, newFake(t, "nobind"))
	st, _ := m.Start(context.Background(), "dev", nil)
	if st.State != StateFailed || !strings.Contains(st.StderrTail, "address already in use") {
		t.Fatalf("want failed with stderr tail, got %+v", st)
	}
}

func TestTooOldPluginFailsClosed(t *testing.T) {
	f := newFake(t, "noflag")
	m := newManager(t, f)
	st, _ := m.Start(context.Background(), "dev", nil)
	if st.State != StateFailed || !strings.Contains(st.Message, "too old") {
		t.Fatalf("got %+v", st)
	}
	if _, err := os.Stat(f.record); err == nil {
		t.Fatal("the dashboard itself must not have been started")
	}
}

func TestNotInstalledReportsInstallHelp(t *testing.T) {
	m := newManager(t, newFake(t, "ok"))
	m.Locate = func() string { return "" }
	for _, st := range []Status{m.Status("dev"), func() Status { s, _ := m.Start(context.Background(), "dev", nil); return s }()} {
		if st.State != StateNotInstalled || st.Install == nil || len(st.Install.Commands) == 0 {
			t.Fatalf("got %+v", st)
		}
	}
}

func TestAcquireNeedsTheRightTokenOfARunningDashboard(t *testing.T) {
	m := newManager(t, newFake(t, "ok"))
	st, _ := m.Start(context.Background(), "dev", nil)
	token := strings.TrimSuffix(strings.TrimPrefix(st.URL, DefaultPrefix), "/")
	if _, _, ok := m.Acquire(token + "x"); ok {
		t.Fatal("wrong token accepted")
	}
	if _, _, ok := m.Acquire(""); ok {
		t.Fatal("empty token accepted")
	}
	port, rel, ok := m.Acquire(token)
	if !ok || port == 0 {
		t.Fatal("right token refused")
	}
	rel()
	m.StopCluster("dev")
	if _, _, ok := m.Acquire(token); ok {
		t.Fatal("token still valid after stop")
	}
	// A restart mints a new token.
	st2, _ := m.Start(context.Background(), "dev", nil)
	if st2.URL == st.URL {
		t.Fatal("token reused across runs")
	}
}

func TestSweepKillsOnlyTheSameProcess(t *testing.T) {
	m := &Manager{DataDir: t.TempDir()}
	start := func() (*exec.Cmd, chan struct{}) {
		c := exec.Command("sleep", "300")
		inOwnGroup(c)
		if err := c.Start(); err != nil {
			t.Skip("no sleep")
		}
		done := make(chan struct{})
		go func() { _ = c.Wait(); close(done) }()
		t.Cleanup(func() { _ = c.Process.Kill() })
		return c, done
	}
	mine, mineDone := start()
	stranger, strangerDone := start()
	if ident(mine.Process.Pid) == "" {
		t.Skip("no ps identity on this platform")
	}
	m.recordPID(mine.Process.Pid, ident(mine.Process.Pid))
	// The stranger's pid is on file with a different identity: a recycled pid.
	m.recordPID(stranger.Process.Pid, "Mon Jan  1 00:00:00 2001 /usr/bin/other")
	m.Sweep()
	select {
	case <-mineDone:
	case <-time.After(3 * time.Second):
		t.Fatal("the orphan was not killed")
	}
	select {
	case <-strangerDone:
		t.Fatal("an unrelated process with a reused pid was killed")
	case <-time.After(300 * time.Millisecond):
	}
	if len(m.readPIDs()) != 0 {
		t.Fatal("pid file not cleared")
	}
}

func TestStartForAnotherNamespaceReplacesTheRunningDashboard(t *testing.T) {
	m := newManager(t, newFake(t, "ok"))
	a, _ := m.Start(context.Background(), "dev", []string{"shop"})
	if a.Namespace != "shop" {
		t.Fatalf("status must say which namespace it runs for: %+v", a)
	}
	pidA := m.pidOf("dev")
	same, _ := m.Start(context.Background(), "dev", []string{"shop"})
	if same.URL != a.URL {
		t.Fatal("same namespace must reuse")
	}
	// Two namespaces mean all namespaces, which is a different run from "shop".
	b, _ := m.Start(context.Background(), "dev", []string{"shop", "infra"})
	if b.State != StateRunning || b.URL == a.URL || b.Namespace != "" {
		t.Fatalf("got %+v", b)
	}
	waitFor(t, "old process gone", func() bool { return gone(pidA) })
	if m.Status("dev").Namespace != "" {
		t.Fatal("status")
	}
}
