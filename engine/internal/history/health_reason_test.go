package history

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Why a workload was broken: each broken hour keeps the reason seen on most
// of its broken ticks ("r" on the health line, still v1), and Health counts
// broken hours per reason. Lines written before reasons existed still read;
// their hours count as broken with no known reason.

// reasonTicks records one tick per entry in codes for workload w ("" = fine
// that tick), padding the hour to n ticks with fine ticks.
func reasonTicks(t *testing.T, s *Store, hour time.Time, n int, w string, codes []string) {
	t.Helper()
	for i := 0; i < n; i++ {
		o := total(100, 100)
		if i < len(codes) && codes[i] != "" {
			o.Broken = []string{w}
			o.Reasons = map[string]string{w: codes[i]}
		}
		if err := s.Record("fp1", meta, hour.Add(time.Duration(i)*time.Minute), []Obs{o}); err != nil {
			t.Fatal(err)
		}
	}
}

func repeat(code string, n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = code
	}
	return out
}

func TestHealth_EachBrokenHourKeepsItsMostSeenReason(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := openTest(t, dir, c)
	defer s.Close()
	const api = "shop/Deployment/api"
	// 10:00 broken: 7 ticks crash-looping, 3 out of memory.
	reasonTicks(t, s, t0, 60, api, append(repeat("CrashLoopBackOff", 7), repeat("OOMKilled", 3)...))
	// 11:00 broken: image pull; a tie at 12:00 goes to the alphabetically first.
	reasonTicks(t, s, t0.Add(time.Hour), 60, api, repeat("ImagePullBackOff", 8))
	reasonTicks(t, s, t0.Add(2*time.Hour), 60, api, append(repeat("Unschedulable", 3), repeat("Pending", 3)...))
	// 13:00 open: crash-looping again, read from the open hour.
	reasonTicks(t, s, t0.Add(3*time.Hour), 6, api, repeat("CrashLoopBackOff", 6))
	c.t = t0.Add(3*time.Hour + 10*time.Minute)

	h, err := s.Health("fp1", api, t0.Add(-time.Hour), c.t)
	if err != nil {
		t.Fatal(err)
	}
	if h.BrokenHours != 4 {
		t.Fatalf("broken hours = %d, want 4", h.BrokenHours)
	}
	want := map[string]int{"CrashLoopBackOff": 2, "ImagePullBackOff": 1, "Pending": 1}
	if len(h.Reasons) != len(want) {
		t.Fatalf("reasons = %v, want %v", h.Reasons, want)
	}
	for k, v := range want {
		if h.Reasons[k] != v {
			t.Fatalf("reasons = %v, want %v", h.Reasons, want)
		}
	}
}

func TestHealth_ReasonsSurviveARestartAndOldLinesStillRead(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := openTest(t, dir, c)
	const api = "shop/Deployment/api"
	reasonTicks(t, s, t0, 20, api, repeat("OOMKilled", 20))
	s.Close() // killed mid-hour: reasons are checkpointed with the open hour
	// A line from before reasons existed, for 08:00, plus that hour's total.
	day := filepath.Join(dir, "fp1")
	early := t0.Add(-2 * time.Hour)
	appendLine(t, filepath.Join(day, "2026-09-30.jsonl"), `{"v":1,"h":"`+early.Format(time.RFC3339)+`","ns":"","n":60,"un":0,"rc":0,"rm":0}`)
	appendLine(t, filepath.Join(day, "2026-09-30.health.jsonl"), `{"v":1,"h":"`+early.Format(time.RFC3339)+`","w":"`+api+`","b":40}`)

	s = openTest(t, dir, c)
	defer s.Close()
	reasonTicks(t, s, t0.Add(time.Hour), 1, api, nil) // closes 10:00
	c.t = t0.Add(time.Hour + time.Minute)
	h, err := s.Health("fp1", api, early, c.t)
	if err != nil {
		t.Fatal(err)
	}
	if h.BrokenHours != 2 || h.Reasons["OOMKilled"] != 1 || len(h.Reasons) != 1 {
		t.Fatalf("Health = %+v; want 2 broken hours, one of them OOMKilled, the old one with no reason", h)
	}
}

func appendLine(t *testing.T, path, line string) {
	t.Helper()
	fh, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()
	if _, err := fh.WriteString(line + "\n"); err != nil {
		t.Fatal(err)
	}
}
