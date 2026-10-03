package history

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The drawer's 7-day chip: which workloads were broken in which recorded
// hours. Broken workloads ride on the cluster-total observation as
// "namespace/Kind/name"; the store keeps one sparse line per workload that
// was broken in an hour, in a day file of its own.

func brokenTick(ws ...string) Obs {
	o := total(100, 100)
	o.Broken = ws
	return o
}

func recordTicks(t *testing.T, s *Store, hour time.Time, n int, broken map[string]int) {
	t.Helper()
	for i := 0; i < n; i++ {
		var ws []string
		for w, k := range broken {
			if i < k {
				ws = append(ws, w)
			}
		}
		if err := s.Record("fp1", meta, hour.Add(time.Duration(i)*time.Minute), []Obs{brokenTick(ws...)}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestHealth_CountsBrokenHoursOverRecordedHours(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := openTest(t, dir, c)
	defer s.Close()
	const api = "shop/Deployment/api"
	recordTicks(t, s, t0, 60, map[string]int{api: 10, "shop/Deployment/web": 1}) // 10:00 broken (10 ticks)
	recordTicks(t, s, t0.Add(time.Hour), 60, map[string]int{api: 2})             // 11:00 two blips: fine
	recordTicks(t, s, t0.Add(2*time.Hour), 4, map[string]int{api: 2})            // 12:00 open, short: half its ticks
	c.t = t0.Add(2*time.Hour + 5*time.Minute)

	if _, err := os.Stat(filepath.Join(dir, "fp1", "2026-09-30.health.jsonl")); err != nil {
		t.Fatalf("health day file: %v", err)
	}
	h, err := s.Health("fp1", api, t0.Add(-24*time.Hour), c.t)
	if err != nil {
		t.Fatal(err)
	}
	want := WorkloadHealth{RecordedHours: 3, BrokenHours: 2, RecordedDays: 1, BrokenDays: 1}
	if h != want {
		t.Fatalf("Health = %+v, want %+v", h, want)
	}
	if h, _ := s.Health("fp1", "shop/Deployment/web", t0.Add(-24*time.Hour), c.t); h.BrokenHours != 0 || h.RecordedHours != 3 {
		t.Fatalf("one broken tick is not a broken hour: %+v", h)
	}
	if h, _ := s.Health("fp1", api, t0.Add(time.Hour), c.t); h.RecordedHours != 2 || h.BrokenHours != 1 {
		t.Fatalf("window from 11:00: %+v", h)
	}
}

func TestHealth_SurvivesReopenAndCountsDays(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := openTest(t, dir, c)
	const api = "shop/Deployment/api"
	recordTicks(t, s, t0, 30, map[string]int{api: 30})
	s.Close() // killed mid-hour: the open hour, health included, is checkpointed
	s = openTest(t, dir, c)
	defer s.Close()
	day2 := t0.Add(24 * time.Hour)
	recordTicks(t, s, day2, 30, nil)
	c.t = day2.Add(time.Hour)
	h, err := s.Health("fp1", api, t0.Add(-time.Hour), c.t)
	if err != nil {
		t.Fatal(err)
	}
	want := WorkloadHealth{RecordedHours: 2, BrokenHours: 1, RecordedDays: 2, BrokenDays: 1}
	if h != want {
		t.Fatalf("Health = %+v, want %+v", h, want)
	}
}

func TestHealth_OverflowHourIsLeftOutForUnlistedWorkloads(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c, func(o *Options) { o.MaxHealthLines = 2 })
	defer s.Close()
	recordTicks(t, s, t0, 60, map[string]int{"a/Deployment/x": 60, "a/Deployment/y": 50, "a/Deployment/z": 40})
	recordTicks(t, s, t0.Add(time.Hour), 1, nil) // closes 10:00
	c.t = t0.Add(time.Hour + time.Minute)
	from := t0.Add(-time.Hour)
	if h, _ := s.Health("fp1", "a/Deployment/x", from, c.t); h.BrokenHours != 1 || h.RecordedHours != 2 {
		t.Fatalf("listed worst workload: %+v", h)
	}
	// z was broken but fell past the cap: that hour says nothing about it,
	// so it is neither broken nor counted as a recorded clean hour.
	if h, _ := s.Health("fp1", "a/Deployment/z", from, c.t); h.BrokenHours != 0 || h.RecordedHours != 1 {
		t.Fatalf("workload past the cap: %+v", h)
	}
}

func TestHealth_PrunedWithItsDay(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := openTest(t, dir, c)
	defer s.Close()
	recordTicks(t, s, t0, 10, map[string]int{"a/Deployment/x": 10})
	recordTicks(t, s, t0.Add(time.Hour), 1, nil)
	p := filepath.Join(dir, "fp1", "2026-09-30.health.jsonl")
	if _, err := os.Stat(p); err != nil {
		t.Fatal(err)
	}
	if err := s.Prune(t0.Add(DefaultRetention + 48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatalf("health file outlived retention: %v", err)
	}
}
