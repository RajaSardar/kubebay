package audit

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestLogger(t *testing.T) *Logger {
	t.Helper()
	dir := t.TempDir()
	f, err := os.OpenFile(filepath.Join(dir, "audit.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	return &Logger{f: f, path: filepath.Join(dir, "audit.log"), log: slog.Default()}
}

func TestEntry_OutcomeRoundTrip(t *testing.T) {
	l := newTestLogger(t)
	l.Record(Entry{Action: "scale", Cluster: "kind-test", Outcome: "rejected", Detail: "webhook=validate.kyverno.svc-fail"})
	l.Record(Entry{Action: "restart", Cluster: "kind-test"})

	entries, err := l.Tail(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(entries))
	}
	if entries[0].Outcome != "rejected" {
		t.Errorf("entries[0].Outcome = %q, want %q", entries[0].Outcome, "rejected")
	}
	if entries[1].Outcome != "" {
		t.Errorf("entries[1].Outcome = %q, want empty (success)", entries[1].Outcome)
	}
}

func TestEntry_BackwardCompatibleWithLogLinesWithoutOutcome(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "audit.log")
	// Simulates a log line written before the Outcome field existed.
	oldLine := `{"time":"2026-01-01T00:00:00Z","action":"apply","cluster":"kind-test"}` + "\n"
	if err := os.WriteFile(path, []byte(oldLine), 0600); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	l := &Logger{f: f, path: path, log: slog.Default()}

	entries, err := l.Tail(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(entries))
	}
	if entries[0].Outcome != "" {
		t.Errorf("Outcome = %q, want empty for a pre-existing log line", entries[0].Outcome)
	}
}

func TestStdoutSink_OneJSONLinePerEntry(t *testing.T) {
	var buf bytes.Buffer
	l := newTestLogger(t)
	l.out = &buf
	l.Record(Entry{Action: "scale", Cluster: "c1", User: "ann@example.com", GVR: "apps/v1/deployments", Namespace: "web", Resource: "api", Detail: "replicas=3"})
	l.Record(Entry{Action: "delete", Cluster: "c1", Outcome: "rejected"})
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("got %d lines, want 2: %q", len(lines), buf.String())
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &m); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"user": "ann@example.com", "action": "scale", "gvr": "apps/v1/deployments", "cluster": "c1", "namespace": "web", "name": "api", "result": "ok", "type": "audit"}
	for k, v := range want {
		if m[k] != v {
			t.Errorf("%s = %v, want %q", k, m[k], v)
		}
	}
	if _, err := time.Parse(time.RFC3339Nano, m["time"].(string)); err != nil {
		t.Errorf("time: %v", err)
	}
	var m2 map[string]any
	_ = json.Unmarshal([]byte(lines[1]), &m2)
	if m2["result"] != "rejected" || m2["user"] != LocalUser {
		t.Errorf("second line = %v", m2)
	}
}

func TestNoStdoutSinkByDefault(t *testing.T) {
	l := newTestLogger(t)
	l.Record(Entry{Action: "scale"}) // must not panic with no sink
}

func TestRotation_CapsDiskAndKeepsQueryAcrossFiles(t *testing.T) {
	dir := t.TempDir()
	l, err := NewWithOptions(slog.Default(), Options{Dir: dir, MaxBytes: 400})
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	for i := 0; i < 20; i++ {
		l.Record(Entry{Action: "scale", Cluster: "c", Resource: fmt.Sprintf("r%02d", i)})
	}
	var total int64
	files, _ := filepath.Glob(filepath.Join(dir, "audit.log*"))
	for _, f := range files {
		st, _ := os.Stat(f)
		total += st.Size()
	}
	if len(files) != 2 {
		t.Fatalf("files = %v, want audit.log and audit.log.1", files)
	}
	if total > 2*400+300 { // one entry of slack per file
		t.Errorf("total %d bytes exceeds cap", total)
	}
	got, err := l.Tail(100)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) == 0 || got[len(got)-1].Resource != "r19" {
		t.Fatalf("tail = %+v", got)
	}
	for i := 1; i < len(got); i++ {
		if got[i].Resource <= got[i-1].Resource {
			t.Fatalf("not oldest first: %+v", got)
		}
	}
}

func TestOptionsFromEnv(t *testing.T) {
	o := OptionsFromEnv(func(k string) string {
		return map[string]string{"KUBEBAY_AUDIT_DIR": "/data", "KUBEBAY_AUDIT_MAX_BYTES": "1048576", "KUBEBAY_AUDIT_STDOUT": "true"}[k]
	}, false)
	if o.Dir != "/data" || o.MaxBytes != 1048576 || !o.Stdout {
		t.Errorf("%+v", o)
	}
	if !OptionsFromEnv(func(string) string { return "" }, true).Stdout {
		t.Error("in-cluster default should be on")
	}
	if OptionsFromEnv(func(string) string { return "" }, false).Stdout {
		t.Error("desktop default should be off")
	}
	if OptionsFromEnv(func(k string) string {
		if k == "KUBEBAY_AUDIT_STDOUT" {
			return "false"
		}
		return ""
	}, true).Stdout {
		t.Error("explicit false must win in cluster")
	}
}
