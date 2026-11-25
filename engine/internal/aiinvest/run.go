package aiinvest

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
)

var (
	// ErrNoClaude: no claude executable on PATH or in the common install paths.
	ErrNoClaude = errors.New("claude is not installed")
	// ErrBusy: this user already has a run going.
	ErrBusy = errors.New("an investigation is already running")
)

// Event is one thing the panel shows. Kind is "text" (assistant text), "tool"
// (a tool name, never its input), "notice" (engine or CLI message) or "end".
type Event struct {
	Kind string `json:"kind"`
	Text string `json:"text,omitempty"`
}

// Investigation is one run and its recorded events.
type Investigation struct {
	ID      string
	User    string
	Cluster string
	Started time.Time

	mu      sync.Mutex
	events  []Event
	changed chan struct{}
	done    bool
	outcome string
	bytes   int

	stopOnce sync.Once
	stopCh   chan struct{}
	finished chan struct{}
}

func (i *Investigation) add(e Event) {
	i.mu.Lock()
	i.events = append(i.events, e)
	old := i.changed
	i.changed = make(chan struct{})
	i.mu.Unlock()
	close(old)
}

func (i *Investigation) finish(outcome string) {
	i.mu.Lock()
	i.done, i.outcome = true, outcome
	i.events = append(i.events, Event{Kind: "end", Text: outcome})
	old := i.changed
	i.changed = make(chan struct{})
	i.mu.Unlock()
	close(old)
	close(i.finished)
}

// Wait returns the events from index from on, and whether the run is over. It
// blocks until there is something new, the run ends or ctx is done.
func (i *Investigation) Wait(ctx context.Context, from int) ([]Event, bool) {
	for {
		i.mu.Lock()
		if from < len(i.events) || i.done {
			evs := append([]Event(nil), i.events[min(from, len(i.events)):]...)
			done := i.done
			i.mu.Unlock()
			return evs, done
		}
		ch := i.changed
		i.mu.Unlock()
		select {
		case <-ch:
		case <-ctx.Done():
			return nil, false
		}
	}
}

// Outcome is "" while running, then done, stopped, timeout, limit or error.
func (i *Investigation) Outcome() string {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.outcome
}

// Done reports whether the run is over.
func (i *Investigation) Done() bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.done
}

// Stop asks the run to end (SIGTERM to its process group, SIGKILL after the grace).
func (i *Investigation) Stop() { i.stopOnce.Do(func() { close(i.stopCh) }) }

// Manager starts and tracks runs.
type Manager struct {
	// Claude is the absolute path of the claude executable; "" = not installed.
	Claude string
	// MCPURL is Kubebay's own loopback MCP endpoint.
	MCPURL string
	// Allowed are the exact mcp__kubebay__<read tool> names.
	Allowed []string
	// Mint makes the per-run, read-only, cluster-scoped token and its revoker.
	Mint  func(cluster, namespace string, ttl time.Duration) (string, func(), error)
	Audit func(audit.Entry)
	// Env is the parent environment (os.Environ); it is scrubbed, never passed on.
	Env      func() []string
	Limits   Limits
	TempRoot string

	mu     sync.Mutex
	runs   map[string]*Investigation
	order  []string
	active map[string]*Investigation
	wg     sync.WaitGroup
}

const keepRuns = 20

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "ai-" + hex.EncodeToString(b)
}

func (m *Manager) record(e audit.Entry) {
	if m.Audit != nil {
		e.Time = time.Now()
		e.Action = "ai-investigation"
		e.Source = "ai-investigation"
		m.Audit(e)
	}
}

// Get returns a run by id.
func (m *Manager) Get(id string) (*Investigation, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	i, ok := m.runs[id]
	return i, ok
}

// Shutdown stops every run and waits for the processes to be gone.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	for _, i := range m.active {
		i.Stop()
	}
	m.mu.Unlock()
	m.wg.Wait()
}

// Start runs one investigation. Nothing is started, minted or written when
// claude is missing or the user already has a run.
func (m *Manager) Start(user string, req Request) (*Investigation, error) {
	if m.Claude == "" {
		return nil, ErrNoClaude
	}
	if strings.TrimSpace(req.Cluster) == "" {
		return nil, errors.New("a cluster is required")
	}
	m.mu.Lock()
	if cur := m.active[user]; cur != nil && !cur.Done() {
		m.mu.Unlock()
		return nil, ErrBusy
	}
	inv := &Investigation{ID: newID(), User: user, Cluster: req.Cluster, Started: time.Now(),
		changed: make(chan struct{}), stopCh: make(chan struct{}), finished: make(chan struct{})}
	if m.runs == nil {
		m.runs, m.active = map[string]*Investigation{}, map[string]*Investigation{}
	}
	m.active[user] = inv
	m.runs[inv.ID] = inv
	m.order = append(m.order, inv.ID)
	for len(m.order) > keepRuns {
		if old := m.runs[m.order[0]]; old != nil && !old.Done() {
			break
		}
		delete(m.runs, m.order[0])
		m.order = m.order[1:]
	}
	m.mu.Unlock()

	fail := func(err error) (*Investigation, error) {
		m.mu.Lock()
		delete(m.active, user)
		delete(m.runs, inv.ID)
		m.mu.Unlock()
		return nil, err
	}

	root, err := os.MkdirTemp(m.TempRoot, "kubebay-ai-")
	if err != nil {
		return fail(err)
	}
	work := root + "/work"
	if err := os.Mkdir(work, 0o700); err != nil {
		_ = os.RemoveAll(root)
		return fail(err)
	}
	token, revoke, err := m.Mint(req.Cluster, req.Namespace, m.Limits.Wall)
	if err != nil {
		_ = os.RemoveAll(root)
		return fail(err)
	}
	cfg, err := WriteMCPConfig(root, m.MCPURL, token)
	if err == nil {
		var args []string
		args, err = BuildArgs(Run{Prompt: BuildPrompt(req), MCPConfigPath: cfg, AllowedTools: m.Allowed})
		if err == nil {
			err = m.launch(inv, req, root, work, args, revoke)
		}
	}
	if err != nil {
		revoke()
		_ = os.RemoveAll(root)
		return fail(err)
	}
	return inv, nil
}

func (m *Manager) launch(inv *Investigation, req Request, root, work string, args []string, revoke func()) error {
	var parent []string
	if m.Env != nil {
		parent = m.Env()
	}
	cmd := exec.Command(m.Claude, args...)
	cmd.Dir = work
	cmd.Env = ScrubEnv(parent)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	outR, outW, err := os.Pipe()
	if err != nil {
		return err
	}
	errR, errW, err := os.Pipe()
	if err != nil {
		outR.Close()
		outW.Close()
		return err
	}
	cmd.Stdout, cmd.Stderr = outW, errW
	if err := cmd.Start(); err != nil {
		outR.Close()
		outW.Close()
		errR.Close()
		errW.Close()
		return err
	}
	outW.Close()
	errW.Close()
	m.record(audit.Entry{User: inv.User, Cluster: req.Cluster, Namespace: req.Namespace, Resource: req.Name,
		Detail: fmt.Sprintf("start id=%s issue=%s", inv.ID, req.IssueID)})

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		m.supervise(inv, req, cmd, outR, errR, root, revoke)
	}()
	return nil
}

func (m *Manager) supervise(inv *Investigation, req Request, cmd *exec.Cmd, outR, errR *os.File, root string, revoke func()) {
	limit := make(chan struct{})
	var limitOnce sync.Once
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		m.readStream(inv, outR, func() { limitOnce.Do(func() { close(limit) }) })
	}()
	stderrDone := make(chan string, 1)
	go func() {
		b, _ := io.ReadAll(io.LimitReader(errR, 2048))
		_, _ = io.Copy(io.Discard, errR)
		stderrDone <- string(b)
	}()
	waitCh := make(chan error, 1)
	go func() { waitCh <- cmd.Wait() }()

	timer := time.NewTimer(m.Limits.Wall)
	defer timer.Stop()
	outcome := "done"
	var waitErr error
	terminate := func() {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		select {
		case waitErr = <-waitCh:
		case <-time.After(m.Limits.Grace):
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			waitErr = <-waitCh
		}
	}
	select {
	case waitErr = <-waitCh:
		if waitErr != nil {
			outcome = "error"
		}
	case <-inv.stopCh:
		outcome = "stopped"
		terminate()
	case <-timer.C:
		outcome = "timeout"
		inv.add(Event{Kind: "notice", Text: fmt.Sprintf("Stopped: the %s time limit was reached.", m.Limits.Wall)})
		terminate()
	case <-limit:
		outcome = "limit"
		terminate()
	}
	// Whatever the leader left behind (a forked helper) dies with the group.
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	select {
	case <-readerDone:
	case <-time.After(2 * time.Second):
		outR.Close()
		<-readerDone
	}
	errText := <-stderrDone
	if outcome == "limit" {
		inv.add(Event{Kind: "notice", Text: "Stopped: the output size limit was reached."})
	}
	if outcome == "error" {
		msg := clean(errText, 500)
		if msg == "" {
			msg = fmt.Sprintf("claude exited with an error (%v).", waitErr)
		}
		inv.add(Event{Kind: "notice", Text: msg})
	}
	revoke()
	_ = os.RemoveAll(root)
	inv.mu.Lock()
	n := inv.bytes
	inv.mu.Unlock()
	m.record(audit.Entry{User: inv.User, Cluster: req.Cluster, Namespace: req.Namespace, Resource: req.Name,
		Outcome: map[bool]string{true: "", false: outcome}[outcome == "done"],
		Detail:  fmt.Sprintf("end id=%s issue=%s outcome=%s duration=%s bytes=%d", inv.ID, req.IssueID, outcome, time.Since(inv.Started).Round(time.Second), n)})
	m.mu.Lock()
	if m.active[inv.User] == inv {
		delete(m.active, inv.User)
	}
	m.mu.Unlock()
	inv.finish(outcome)
}

type streamLine struct {
	Type    string `json:"type"`
	IsError bool   `json:"is_error"`
	Result  string `json:"result"`
	Message struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
			Name string `json:"name"`
		} `json:"content"`
	} `json:"message"`
}

func plain(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || !unicode.IsControl(r) {
			return r
		}
		return -1
	}, s)
}

// readStream turns stream-json lines into events: assistant text and tool
// names only (a tool's input is never forwarded). Text is capped.
func (m *Manager) readStream(inv *Investigation, r io.Reader, hitLimit func()) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	for sc.Scan() {
		var l streamLine
		if json.Unmarshal(sc.Bytes(), &l) != nil {
			continue
		}
		switch l.Type {
		case "assistant":
			for _, c := range l.Message.Content {
				switch c.Type {
				case "text":
					t := plain(c.Text)
					inv.mu.Lock()
					room := m.Limits.MaxOutput - inv.bytes
					if len(t) > room {
						t = t[:max(room, 0)]
					}
					inv.bytes += len(t)
					over := inv.bytes >= m.Limits.MaxOutput
					inv.mu.Unlock()
					if t != "" {
						inv.add(Event{Kind: "text", Text: t})
					}
					if over {
						hitLimit()
						_, _ = io.Copy(io.Discard, r)
						return
					}
				case "tool_use":
					inv.add(Event{Kind: "tool", Text: clean(c.Name, 100)})
				}
			}
		case "result":
			if l.IsError {
				inv.add(Event{Kind: "notice", Text: clean(l.Result, 500)})
			}
		}
	}
	_, _ = io.Copy(io.Discard, r)
}
