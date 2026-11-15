package audit

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
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
