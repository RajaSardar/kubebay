package history

import (
	"testing"
	"time"
)

func TestSummary_BucketsMaxOverHoursWithNullGaps(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c)
	defer s.Close()
	rec := func(at time.Time, cpu int64, req int64) {
		t.Helper()
		o := Obs{CPUMillis: cpu, MemBytes: cpu * 10, HasUsage: true, ReqCPUMillis: req, ReqMemBytes: req * 10}
		if err := s.Record("fp1", meta, at, []Obs{o, {Ns: "shop", CPUMillis: 1, HasUsage: true}}); err != nil {
			t.Fatal(err)
		}
	}
	// t0 is 10:00. Bucket 08:00-12:00 sees 10:00 and 11:00; 12:00-16:00 sees 12:00.
	rec(t0, 100, 500)
	rec(t0.Add(30*time.Minute), 300, 600)
	rec(t0.Add(time.Hour), 200, 400)
	rec(t0.Add(2*time.Hour), 50, 700)
	c.t = t0.Add(2*time.Hour + 10*time.Minute)

	from := t0.Add(-10 * time.Hour) // 00:00
	sum := s.Summary("fp1", from, c.t, 4*time.Hour)
	if len(sum.Points) != 4 {
		t.Fatalf("want 4 four-hour buckets from 00:00 to 12:10, got %d", len(sum.Points))
	}
	if sum.Points[0].CPUMax != nil || sum.Points[1].CPUMax != nil {
		t.Errorf("unobserved buckets must stay null: %+v", sum.Points[:2])
	}
	b := sum.Points[2]
	if !b.T.Equal(t0.Add(-2*time.Hour)) || b.CPUMax == nil || *b.CPUMax != 300 || *b.ReqCPUMillis != 600 {
		t.Errorf("08:00 bucket = %+v, want max cpu 300 and max request 600 (hourly max, not mean)", b)
	}
	if p := sum.Points[3]; p.CPUMax == nil || *p.CPUMax != 50 || *p.ReqCPUMillis != 700 {
		t.Errorf("the open hour must be included: %+v", p)
	}
	if sum.LastSample == nil || !sum.LastSample.Equal(t0.Add(2*time.Hour)) {
		t.Errorf("last sample = %v", sum.LastSample)
	}
}

func TestSummary_CapacityFromLatestHourThatHadIt(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c)
	defer s.Close()
	withCap := Obs{HasUsage: true, CPUMillis: 10, AllocCPUMillis: 4000, AllocMemBytes: 8 << 30, Nodes: 2}
	if err := s.Record("fp1", meta, t0, []Obs{withCap}); err != nil {
		t.Fatal(err)
	}
	// A later hour whose node list failed must not erase the known capacity.
	if err := s.Record("fp1", meta, t0.Add(time.Hour), []Obs{{HasUsage: true, CPUMillis: 20}}); err != nil {
		t.Fatal(err)
	}
	c.t = t0.Add(90 * time.Minute)
	sum := s.Summary("fp1", t0.Add(-24*time.Hour), c.t, 4*time.Hour)
	if sum.AllocCPUMillis != 4000 || sum.AllocMemBytes != 8<<30 || sum.Nodes != 2 {
		t.Errorf("capacity = %d/%d/%d, want 4000/8Gi/2", sum.AllocCPUMillis, sum.AllocMemBytes, sum.Nodes)
	}
}

func TestSummary_ReopenedStoreReadsCapacityFromDisk(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := openTest(t, dir, c)
	if err := s.Record("fp1", meta, t0, []Obs{{HasUsage: true, AllocCPUMillis: 2000, Nodes: 1}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Record("fp1", meta, t0.Add(time.Hour), []Obs{{HasUsage: true}}); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	c.t = t0.Add(2 * time.Hour)
	s2 := openTest(t, dir, c)
	defer s2.Close()
	if sum := s2.Summary("fp1", t0.Add(-time.Hour), c.t, time.Hour); sum.Nodes != 1 || sum.AllocCPUMillis != 2000 {
		t.Errorf("capacity lost across restart: %+v", sum)
	}
}

func TestRecorder_AllFingerprintsPicksOnePerCluster(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c)
	defer s.Close()
	other := Meta{ClusterID: "stage", Context: "stage", Server: "https://x"}
	for _, r := range []struct {
		fp string
		m  Meta
	}{{"fp1", meta}, {"fp2", other}} {
		if err := s.Record(r.fp, r.m, t0, []Obs{{HasUsage: true}}); err != nil {
			t.Fatal(err)
		}
	}
	got := NewRecorder(s).AllFingerprints()
	if len(got) != 2 || got["kind-dev"] != "fp1" || got["stage"] != "fp2" {
		t.Errorf("fingerprints = %v", got)
	}
}
