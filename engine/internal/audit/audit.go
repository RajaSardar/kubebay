package audit

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// LocalUser is the acting identity of an entry no OIDC login stands behind:
// the desktop app's launch token, an unauthenticated loopback engine, or an
// MCP client holding the engine's own token.
const LocalUser = "local"

// UserFrom returns the OIDC user (email, else preferred_username) the request
// on ctx was authenticated as, or LocalUser when there is none.
func UserFrom(ctx context.Context) string {
	if ident := clusters.IdentityFromContext(ctx); ident != nil && ident.Name != "" {
		return ident.Name
	}
	return LocalUser
}

type Entry struct {
	Time    time.Time `json:"time"`
	Action  string    `json:"action"` // "exec", "port-forward", "scale", "delete", "restart", "drain", "cordon", "apply"
	Cluster string    `json:"cluster"`
	// User is who acted: the OIDC user, or LocalUser. Empty only on lines
	// written before the field existed.
	User string `json:"user,omitempty"`
	// GVR is the kind acted on, as "group/version/resource" ("v1/pods",
	// "apps/v1/deployments"; Helm releases are "helm/releases"). Empty on
	// older lines and on entries not about one object (local shell).
	GVR       string `json:"gvr,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Resource  string `json:"resource,omitempty"` // object name
	Detail    string `json:"detail,omitempty"`   // extra context (command, replicas, etc.)
	UserAgent string `json:"userAgent,omitempty"`
	// Outcome is empty for a successful mutation (the default, and the only
	// value every entry recorded before this field existed has) or
	// "rejected" when an admission webhook denied the request — see
	// writePolicyRejectionOrError, which every mutating handler now routes
	// through. Empty-string default keeps old log lines and this struct
	// backward compatible with each other.
	Outcome string `json:"outcome,omitempty"`
	// Source is "mcp" for a call an AI client made through Kubebay's MCP
	// server (backlog #5), empty for the UI. Reads are audited there too.
	Source string `json:"source,omitempty"`
}

type Logger struct {
	mu   sync.Mutex
	f    *os.File
	path string
	log  *slog.Logger
	// out, when set, gets every entry as one JSON line (see stdoutLine).
	out io.Writer
	// maxBytes, when above zero, rotates the file once it is that big:
	// audit.log becomes audit.log.1 (replacing the one before), so the
	// log never takes more than about twice maxBytes on disk.
	maxBytes int64
	size     int64
}

// Options configures where and how the audit log is kept. The zero value is
// the desktop behaviour: <user config dir>/kubebay/audit.log, no cap, no
// stdout copy.
type Options struct {
	// Dir holds audit.log; empty means <user config dir>/kubebay.
	Dir string
	// MaxBytes rotates audit.log at this size; zero or less never rotates.
	MaxBytes int64
	// Stdout copies every entry to the process's stdout as a JSON line.
	Stdout bool
}

// OptionsFromEnv reads KUBEBAY_AUDIT_DIR, KUBEBAY_AUDIT_MAX_BYTES and
// KUBEBAY_AUDIT_STDOUT ("true"/"false"). The stdout copy is on by default in
// a cluster, where the container log is what a collector reads, and off on
// the desktop.
func OptionsFromEnv(getenv func(string) string, inCluster bool) Options {
	o := Options{Dir: getenv("KUBEBAY_AUDIT_DIR"), Stdout: inCluster}
	if n, err := strconv.ParseInt(getenv("KUBEBAY_AUDIT_MAX_BYTES"), 10, 64); err == nil && n > 0 {
		o.MaxBytes = n
	}
	if v, err := strconv.ParseBool(getenv("KUBEBAY_AUDIT_STDOUT")); err == nil {
		o.Stdout = v
	}
	return o
}

func New(log *slog.Logger) (*Logger, error) { return NewWithOptions(log, Options{}) }

func NewWithOptions(log *slog.Logger, opts Options) (*Logger, error) {
	dir := opts.Dir
	if dir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			base = os.TempDir()
		}
		dir = filepath.Join(base, "kubebay")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "audit.log")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return nil, fmt.Errorf("audit: open %s: %w", path, err)
	}
	l := &Logger{f: f, path: path, log: log, maxBytes: opts.MaxBytes}
	if st, err := f.Stat(); err == nil {
		l.size = st.Size()
	}
	if opts.Stdout {
		l.out = os.Stdout
	}
	log.Info("audit log", "path", path, "stdout", opts.Stdout, "maxBytes", opts.MaxBytes)
	return l, nil
}

// stdoutLine is the shape of an entry on stdout. Result is "ok" or
// "rejected"; Name is the object's name. Detail never carries Secret values
// (callers record references only).
type stdoutLine struct {
	Type      string    `json:"type"`
	Time      time.Time `json:"time"`
	User      string    `json:"user"`
	Action    string    `json:"action"`
	GVR       string    `json:"gvr,omitempty"`
	Cluster   string    `json:"cluster"`
	Namespace string    `json:"namespace,omitempty"`
	Name      string    `json:"name,omitempty"`
	Result    string    `json:"result"`
	Detail    string    `json:"detail,omitempty"`
	Source    string    `json:"source,omitempty"`
	UserAgent string    `json:"userAgent,omitempty"`
}

func (l *Logger) rotate() {
	_ = l.f.Close()
	if err := os.Rename(l.path, l.path+".1"); err != nil {
		l.log.Error("audit rotate", "err", err)
	}
	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		l.log.Error("audit reopen", "err", err)
		return
	}
	l.f, l.size = f, 0
}

func (l *Logger) Record(e Entry) {
	if l == nil {
		return
	}
	e.Time = time.Now().UTC()
	if e.User == "" {
		e.User = LocalUser
	}
	b, _ := json.Marshal(e)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.maxBytes > 0 && l.size > 0 && l.size+int64(len(b))+1 > l.maxBytes {
		l.rotate()
	}
	n, _ := fmt.Fprintf(l.f, "%s\n", b)
	l.size += int64(n)
	if l.out != nil {
		res := "ok"
		if e.Outcome != "" {
			res = e.Outcome
		}
		sb, _ := json.Marshal(stdoutLine{Type: "audit", Time: e.Time, User: e.User, Action: e.Action, GVR: e.GVR,
			Cluster: e.Cluster, Namespace: e.Namespace, Name: e.Resource, Result: res, Detail: e.Detail, Source: e.Source, UserAgent: e.UserAgent})
		_, _ = fmt.Fprintf(l.out, "%s\n", sb)
	}
}

// RecordCtx records e as done by the identity on ctx (see UserFrom), unless e
// already names a user. Every handler that has a request records through it.
func (l *Logger) RecordCtx(ctx context.Context, e Entry) {
	if e.User == "" {
		e.User = UserFrom(ctx)
	}
	l.Record(e)
}

// Filter narrows Query. Empty fields match anything.
type Filter struct {
	Cluster, Namespace, Resource string
	// User matches the acting identity exactly.
	User string
	// Kind matches the entry's GVR in full ("apps/v1/deployments") or by its
	// plural resource ("deployments"), case-insensitively.
	Kind string
}

func (f Filter) match(e Entry) bool {
	return (f.Cluster == "" || e.Cluster == f.Cluster) &&
		(f.Namespace == "" || e.Namespace == f.Namespace) &&
		(f.Resource == "" || e.Resource == f.Resource) &&
		(f.User == "" || e.User == f.User) &&
		(f.Kind == "" || kindMatches(e.GVR, f.Kind))
}

func kindMatches(gvr, kind string) bool {
	if gvr == "" {
		return false
	}
	return strings.EqualFold(gvr, kind) || strings.EqualFold(gvr[strings.LastIndex(gvr, "/")+1:], kind)
}

// Tail returns the last n entries from the audit log file.
func (l *Logger) Tail(n int) ([]Entry, error) { return l.Query(Filter{}, n) }

// Query returns the last n entries matching f, oldest first. It filters
// before it takes the last n, so an object's old entries are not pushed out
// by other objects' activity.
func (l *Logger) Query(flt Filter, n int) ([]Entry, error) {
	if l == nil {
		return nil, nil
	}
	l.mu.Lock()
	path := l.path
	l.mu.Unlock()

	var lines []string
	for _, p := range []string{path + ".1", path} {
		got, err := readLines(p)
		if err != nil {
			return nil, err
		}
		lines = append(lines, got...)
	}

	entries := make([]Entry, 0, len(lines))
	for _, line := range lines {
		var e Entry
		if err := json.Unmarshal([]byte(line), &e); err == nil && flt.match(e) {
			entries = append(entries, e)
		}
	}
	if len(entries) > n {
		entries = entries[len(entries)-n:]
	}
	return entries, nil
}

func (l *Logger) Close() error {
	if l == nil || l.f == nil {
		return nil
	}
	return l.f.Close()
}

// readLines returns the non-empty lines of path; a missing file has none.
func readLines(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()
	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if line := scanner.Text(); line != "" {
			lines = append(lines, line)
		}
	}
	return lines, scanner.Err()
}
