package history

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// clock is a settable fake Now.
type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

var t0 = time.Date(2026, 9, 30, 10, 0, 0, 0, time.UTC)

func openTest(t *testing.T, dir string, c *clock, mod ...func(*Options)) *Store {
	t.Helper()
	o := Options{Now: c.now, Location: time.UTC}
	for _, m := range mod {
		m(&o)
	}
	s, err := Open(dir, o)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return s
}

var meta = Meta{ClusterID: "kind-dev", Context: "kind-dev", Server: "https://127.0.0.1:6443"}

func total(cpu, mem int64) Obs {
	return Obs{CPUMillis: cpu, MemBytes: mem, HasUsage: true, ReqCPUMillis: 1000, ReqMemBytes: 1 << 30}
}

func f(v float64) *float64 { return &v }

// Test 1: an hour closes into one bucket with exact mean, max and sample count.
func TestRecord_ClosesHourIntoBucketWithExactMeanMaxN(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c)
	defer s.Close()
	for i := 0; i < 60; i++ {
		if err := s.Record("fp1", meta, t0.Add(time.Duration(i)*time.Minute), []Obs{total(int64(100+i), 1000)}); err != nil {
			t.Fatal(err)
		}
	}
	// First tick of the next hour closes 10:00.
	if err := s.Record("fp1", meta, t0.Add(time.Hour), []Obs{total(5, 5)}); err != nil {
		t.Fatal(err)
	}
	c.t = t0.Add(2 * time.Hour)
	ser, err := s.Query("fp1", "", t0, t0.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(ser.Points) != 1 {
		t.Fatalf("want 1 point, got %d", len(ser.Points))
	}
	p := ser.Points[0]
	if p.Samples != 60 || !p.WellSampled {
		t.Fatalf("samples=%d wellSampled=%v", p.Samples, p.WellSampled)
	}
	if *p.CPUMean != 129.5 || *p.CPUMax != 159 || *p.MemMean != 1000 || *p.MemMax != 1000 {
		t.Fatalf("stats: mean=%v max=%v mem=%v/%v", *p.CPUMean, *p.CPUMax, *p.MemMean, *p.MemMax)
	}
	if *p.ReqCPUMillis != 1000 || *p.ReqMemBytes != 1<<30 {
		t.Fatalf("requests: %v %v", *p.ReqCPUMillis, *p.ReqMemBytes)
	}
}

// Test 2: ticks without usage (no metrics-server) keep usage null; requests still recorded.
func TestRecord_NoUsageTicksKeepUsageNull(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c)
	defer s.Close()
	for i := 0; i < 40; i++ {
		_ = s.Record("fp1", meta, t0.Add(time.Duration(i)*time.Minute), []Obs{{ReqCPUMillis: 500, ReqMemBytes: 1024}})
	}
	c.t = t0.Add(30 * time.Minute)
	ser, _ := s.Query("fp1", "", t0, t0.Add(time.Hour))
	p := ser.Points[0]
	if p.CPUMean != nil || p.CPUMax != nil || p.MemMean != nil || p.MemMax != nil {
		t.Fatalf("usage must be null without metrics, got %+v", p)
	}
	if p.ReqCPUMillis == nil || *p.ReqCPUMillis != 500 {
		t.Fatalf("requests still recorded, got %+v", p.ReqCPUMillis)
	}
	b, _ := json.Marshal(p)
	if !strings.Contains(string(b), `"cpuMean":null`) {
		t.Fatalf("null must serialise as null: %s", b)
	}
}

// Test 3: hours with no samples come back as null points, never interpolated.
func TestQuery_MissingHoursNullNotInterpolated(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c)
	defer s.Close()
	_ = s.Record("fp1", meta, t0, []Obs{total(100, 1)})
	_ = s.Record("fp1", meta, t0.Add(3*time.Hour), []Obs{total(300, 1)})
	c.t = t0.Add(4 * time.Hour)
	ser, _ := s.Query("fp1", "", t0, t0.Add(4*time.Hour))
	if len(ser.Points) != 4 {
		t.Fatalf("want 4 hourly points, got %d", len(ser.Points))
	}
	for _, i := range []int{1, 2} {
		if ser.Points[i].Samples != 0 || ser.Points[i].CPUMean != nil {
			t.Fatalf("hour %d must be an empty null point, got %+v", i, ser.Points[i])
		}
	}
	if *ser.Points[3].CPUMean != 300 {
		t.Fatalf("open hour included from memory, got %+v", ser.Points[3])
	}
}

// Test 4: an hour with fewer than 30 samples is not well-sampled.
func TestQuery_ThinHourNotWellSampled(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c)
	defer s.Close()
	for i := 0; i < 10; i++ {
		_ = s.Record("fp1", meta, t0.Add(time.Duration(i)*time.Minute), []Obs{total(1, 1)})
	}
	c.t = t0.Add(20 * time.Minute)
	ser, _ := s.Query("fp1", "", t0, t0.Add(time.Hour))
	if ser.Points[0].Samples != 10 || ser.Points[0].WellSampled {
		t.Fatalf("got %+v", ser.Points[0])
	}
}

// Test 5: a crash (no Close) loses nothing already recorded in the open hour.
func TestStore_ReopenWithoutCloseRestoresOpenHour(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s1 := openTest(t, dir, c)
	for i := 0; i < 35; i++ {
		_ = s1.Record("fp1", meta, t0.Add(time.Duration(i)*time.Minute), []Obs{total(10, 1)})
	}
	// Simulated SIGKILL: s1 is never closed. The heartbeat goes stale.
	c.t = t0.Add(40 * time.Minute)
	s2 := openTest(t, dir, c)
	defer s2.Close()
	if s2.ReadOnly() {
		t.Fatal("stale lock must be reclaimed")
	}
	_ = s2.Record("fp1", meta, t0.Add(40*time.Minute), []Obs{total(10, 1)})
	ser, _ := s2.Query("fp1", "", t0, t0.Add(time.Hour))
	if ser.Points[0].Samples != 36 {
		t.Fatalf("want 35 restored + 1 new samples, got %d", ser.Points[0].Samples)
	}
}

// Test 6: a torn trailing line in a day file is skipped, earlier lines survive.
func TestStore_TornTrailingLineSkipped(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := openTest(t, dir, c)
	_ = s.Record("fp1", meta, t0, []Obs{total(100, 1)})
	_ = s.Record("fp1", meta, t0.Add(time.Hour), []Obs{total(200, 1)}) // closes 10:00
	_ = s.Close()
	day := filepath.Join(dir, "fp1", "2026-09-30.jsonl")
	fh, err := os.OpenFile(day, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fh.WriteString(`{"v":1,"h":"2026-09-30T11:00:00Z","ns":"","n":6`)
	_ = fh.Close()
	s2 := openTest(t, dir, c)
	defer s2.Close()
	ser, err := s2.Query("fp1", "", t0, t0.Add(time.Hour))
	if err != nil {
		t.Fatalf("torn line must not fail the read: %v", err)
	}
	if *ser.Points[0].CPUMean != 100 {
		t.Fatalf("earlier line lost: %+v", ser.Points[0])
	}
}

// Test 7: prune keeps the retention boundary day, drops the one before; meta records retention.
func TestPrune_RetentionBoundaryAndMetaRecordsRetention(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := openTest(t, dir, c)
	defer s.Close()
	_ = s.Record("fp1", meta, t0, []Obs{total(1, 1)})
	for _, d := range []int{35, 36} {
		name := t0.AddDate(0, 0, -d).Format("2006-01-02") + ".jsonl"
		if err := os.WriteFile(filepath.Join(dir, "fp1", name), []byte("{}\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Prune(t0); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "fp1", t0.AddDate(0, 0, -35).Format("2006-01-02")+".jsonl")); err != nil {
		t.Fatal("day 35 must be kept")
	}
	if _, err := os.Stat(filepath.Join(dir, "fp1", t0.AddDate(0, 0, -36).Format("2006-01-02")+".jsonl")); !os.IsNotExist(err) {
		t.Fatal("day 36 must be pruned")
	}
	b, _ := os.ReadFile(filepath.Join(dir, "fp1", "meta.json"))
	var m struct {
		ClusterID     string `json:"clusterId"`
		RetentionDays int    `json:"retentionDays"`
	}
	_ = json.Unmarshal(b, &m)
	if m.RetentionDays != 35 || m.ClusterID != "kind-dev" {
		t.Fatalf("meta.json: %s", b)
	}
}

// The total-size guard evicts the oldest day first, across clusters.
func TestPrune_TotalBytesGuardEvictsOldestDayFirst(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := openTest(t, dir, c, func(o *Options) { o.MaxTotalBytes = 250 })
	defer s.Close()
	_ = s.Record("fpA", meta, t0, []Obs{total(1, 1)})
	_ = s.Record("fpB", Meta{ClusterID: "other"}, t0, []Obs{total(1, 1)})
	write := func(fp string, daysAgo int) string {
		p := filepath.Join(dir, fp, t0.AddDate(0, 0, -daysAgo).Format("2006-01-02")+".jsonl")
		_ = os.WriteFile(p, []byte(strings.Repeat("x", 100)), 0o600)
		return p
	}
	oldest := write("fpB", 5)
	mid := write("fpA", 3)
	newest := write("fpB", 1)
	if err := s.Prune(t0); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(oldest); !os.IsNotExist(err) {
		t.Fatal("oldest day (other cluster) must go first")
	}
	for _, p := range []string{mid, newest} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("%s should survive", p)
		}
	}
}

// Test 9: clusters never share data.
func TestStore_ClustersIsolated(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c)
	defer s.Close()
	_ = s.Record("fpA", meta, t0, []Obs{total(111, 1)})
	_ = s.Record("fpB", Meta{ClusterID: "prod"}, t0, []Obs{total(999, 1)})
	a, _ := s.Query("fpA", "", t0, t0.Add(time.Hour))
	b, _ := s.Query("fpB", "", t0, t0.Add(time.Hour))
	if *a.Points[0].CPUMean != 111 || *b.Points[0].CPUMean != 999 {
		t.Fatalf("a=%v b=%v", *a.Points[0].CPUMean, *b.Points[0].CPUMean)
	}
}

// Test 10: a second writer on the same directory goes read-only; a stale heartbeat is reclaimed.
func TestLock_SecondWriterReadOnly_StaleHeartbeatReclaimed(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s1 := openTest(t, dir, c)
	s2 := openTest(t, dir, c)
	if s1.ReadOnly() || !s2.ReadOnly() {
		t.Fatalf("s1 ro=%v s2 ro=%v", s1.ReadOnly(), s2.ReadOnly())
	}
	if err := s2.Record("fp1", meta, t0, []Obs{total(1, 1)}); err != ErrReadOnly {
		t.Fatalf("want ErrReadOnly, got %v", err)
	}
	_ = s2.Close()
	_ = s1.Record("fp1", meta, t0, []Obs{total(1, 1)}) // refreshes the heartbeat
	c.t = t0.Add(10 * time.Minute)                     // > 3 heartbeats with no Record
	s3 := openTest(t, dir, c)
	defer s3.Close()
	if s3.ReadOnly() {
		t.Fatal("stale heartbeat must be reclaimed")
	}
}

// Test 11: namespaces beyond the cap fold into "(other)" so totals still add up.
func TestNamespaceCap_TopNPlusOtherSumsToTotal(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c, func(o *Options) { o.MaxNamespaces = 2 })
	defer s.Close()
	ns := func(name string, cpu, req int64) Obs {
		return Obs{Ns: name, CPUMillis: cpu, MemBytes: 1, HasUsage: true, ReqCPUMillis: req, ReqMemBytes: 1}
	}
	obs := []Obs{
		{CPUMillis: 60, MemBytes: 4, HasUsage: true, ReqCPUMillis: 1000, ReqMemBytes: 4},
		ns("big", 30, 500), ns("mid", 20, 300), ns("small", 7, 100), ns("tiny", 3, 100),
	}
	_ = s.Record("fp1", meta, t0, obs)
	var sum float64
	for _, name := range []string{"big", "mid", OtherNamespace} {
		ser, _ := s.Query("fp1", name, t0, t0.Add(time.Hour))
		if ser.Points[0].CPUMean == nil {
			t.Fatalf("namespace %q missing", name)
		}
		sum += *ser.Points[0].CPUMean
	}
	if sum != 60 {
		t.Fatalf("top-N + (other) = %v, want the cluster total 60", sum)
	}
	small, _ := s.Query("fp1", "small", t0, t0.Add(time.Hour))
	if small.Points[0].Samples != 0 {
		t.Fatal("folded namespaces must not get their own series")
	}
}

// Test 12: HourOfDayObserved counts only well-sampled hours.
func TestCoverage_HourOfDayCountsOnlyWellSampled(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c)
	defer s.Close()
	fill := func(h time.Time, n int) {
		for i := 0; i < n; i++ {
			_ = s.Record("fp1", meta, h.Add(time.Duration(i)*time.Minute), []Obs{total(1, 1)})
		}
	}
	fill(t0, 45)                 // 10:00 well sampled
	fill(t0.Add(time.Hour), 5)   // 11:00 thin
	fill(t0.Add(2*time.Hour), 1) // closes 11:00
	c.t = t0.Add(3 * time.Hour)
	cov, err := s.Status("fp1")
	if err != nil {
		t.Fatal(err)
	}
	if cov.HourOfDayObserved[10] != 1 || cov.HourOfDayObserved[11] != 0 {
		t.Fatalf("hourOfDay: %v", cov.HourOfDayObserved)
	}
	if cov.ObservedHours != 3 || cov.WellSampledHours != 1 || cov.ExpectedHours != 840 || cov.RetentionDays != 35 {
		t.Fatalf("coverage: %+v", cov)
	}
}

// Test 13: the coverage label names what was observed.
func TestCoverage_Label(t *testing.T) {
	var hod [24]int
	set := func(from, to int) {
		for h := from; h < to; h++ {
			hod[h] = 3
		}
	}
	cases := []struct {
		name    string
		setup   func()
		weekend bool
		want    string
	}{
		{"none", func() {}, false, "no well-sampled hours yet"},
		{"contiguous weekdays", func() { set(9, 18) }, false, "observed 09–18 local, weekdays only"},
		{"split with weekend", func() { set(8, 12); set(14, 18) }, true, "observed 08–12, 14–18 local"},
		{"round the clock", func() { set(0, 24) }, true, "round-the-clock"},
	}
	for _, tc := range cases {
		hod = [24]int{}
		tc.setup()
		if got := coverageLabel(hod, tc.weekend); got != tc.want {
			t.Errorf("%s: got %q want %q", tc.name, got, tc.want)
		}
	}
}

// Test 8: fingerprint is the kube-system UID when readable, else context+server; always a safe filename.
func TestFingerprint_KubeSystemUIDThenFallback_FilenameSafe(t *testing.T) {
	ctx := context.Background()
	ks := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "kube-system", UID: "11111111-2222"}}
	withUID := Fingerprint(ctx, fake.NewSimpleClientset(ks), "arn:aws:eks:us-east-1:1:cluster/x", "https://x")
	sameUIDOtherCtx := Fingerprint(ctx, fake.NewSimpleClientset(ks), "renamed", "https://y")
	if withUID != sameUIDOtherCtx {
		t.Fatal("same kube-system UID must give the same fingerprint regardless of context name")
	}
	recreated := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "kube-system", UID: "99999999"}}
	if Fingerprint(ctx, fake.NewSimpleClientset(recreated), "arn:aws:eks:us-east-1:1:cluster/x", "https://x") == withUID {
		t.Fatal("a recreated cluster must not inherit history")
	}
	fallbackA := Fingerprint(ctx, fake.NewSimpleClientset(), "arn:aws:eks:us-east-1:1:cluster/x", "https://x")
	fallbackB := Fingerprint(ctx, fake.NewSimpleClientset(), "arn:aws:eks:us-east-1:1:cluster/x", "https://other")
	if fallbackA == fallbackB || fallbackA == withUID {
		t.Fatal("fallback must hash context and server")
	}
	safe := regexp.MustCompile(`^[0-9a-f]{16}$`)
	for _, fp := range []string{withUID, fallbackA} {
		if !safe.MatchString(fp) {
			t.Fatalf("unsafe fingerprint %q", fp)
		}
	}
}

// Erase removes every directory recorded for a cluster ID, and nothing else.
func TestEraseCluster_RemovesAllDirsForCluster(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := openTest(t, dir, c)
	defer s.Close()
	_ = s.Record("fpOld", meta, t0, []Obs{total(1, 1)})
	_ = s.Record("fpNew", meta, t0, []Obs{total(1, 1)}) // same cluster ID, recreated cluster
	_ = s.Record("fpOther", Meta{ClusterID: "prod"}, t0, []Obs{total(1, 1)})
	n, err := s.EraseCluster("kind-dev")
	if err != nil || n != 2 {
		t.Fatalf("erased %d, err %v", n, err)
	}
	for fp, want := range map[string]bool{"fpOld": false, "fpNew": false, "fpOther": true} {
		_, err := os.Stat(filepath.Join(dir, fp))
		if (err == nil) != want {
			t.Fatalf("%s exists=%v want %v", fp, err == nil, want)
		}
	}
	cov, _ := s.Status("fpNew")
	if cov.ObservedHours != 0 {
		t.Fatal("erased cluster must report no observed hours, including the in-memory open hour")
	}
}

// No TempDir fallback: an unusable directory is an error, and recording stays off.
func TestOpen_UnusableDirIsAnError(t *testing.T) {
	file := filepath.Join(t.TempDir(), "not-a-dir")
	_ = os.WriteFile(file, nil, 0o600)
	if _, err := Open(filepath.Join(file, "history"), Options{}); err == nil {
		t.Fatal("want an error, not a fallback directory")
	}
}

// Directories and files are private to the user.
func TestStore_PrivatePermissions(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "history")
	c := &clock{t0}
	s := openTest(t, dir, c)
	defer s.Close()
	_ = s.Record("fp1", meta, t0, []Obs{total(1, 1)})
	for p, want := range map[string]os.FileMode{dir: 0o700, filepath.Join(dir, "fp1"): 0o700, filepath.Join(dir, "fp1", "meta.json"): 0o600} {
		st, err := os.Stat(p)
		if err != nil {
			t.Fatal(err)
		}
		if st.Mode().Perm() != want {
			t.Fatalf("%s perm %v want %v", p, st.Mode().Perm(), want)
		}
	}
}
