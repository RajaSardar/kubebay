package auditfeed

import (
	"compress/gzip"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func secretRead(id, user, ns, name string, at time.Time) string {
	return fmt.Sprintf(`{"auditID":%q,"stage":"ResponseComplete","verb":"get","user":{"username":%q},"objectRef":{"resource":"secrets","namespace":%q,"name":%q},"responseStatus":{"code":200},"stageTimestamp":%q}`,
		id, user, ns, name, at.UTC().Format("2006-01-02T15:04:05.000000Z"))
}

func execAt(id string, at time.Time) string {
	return strings.Replace(strings.Replace(execEvent, `"a1"`, fmt.Sprintf("%q", id), 1), "2026-10-01T10:00:00.000000Z", at.UTC().Format("2006-01-02T15:04:05.000000Z"), 1)
}

func writeLog(t *testing.T, path string, lines []string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

var t0 = time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC)

func TestSecretReadsByOnePersonGroupIntoOneRow(t *testing.T) {
	var lines []string
	for i := 0; i < 25; i++ {
		lines = append(lines, secretRead(fmt.Sprintf("s%d", i), "alice", "shop", fmt.Sprintf("db-%d", i%3), t0.Add(time.Duration(i)*5*time.Second)))
	}
	lines = append(lines, secretRead("b1", "bob", "shop", "db-0", t0.Add(time.Minute)))
	// Twenty minutes later alice reads again: a new burst, not the same one.
	lines = append(lines, secretRead("late", "alice", "shop", "db-0", t0.Add(20*time.Minute)))
	path := filepath.Join(t.TempDir(), "audit.log")
	writeLog(t, path, lines)

	got, err := ReadTail(path, 1<<20, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 rows (alice's burst, bob, alice later), got %d: %+v", len(got), got)
	}
	late, burst, bob := got[0], got[1], got[2]
	if late.ID != "late" || late.Count != 0 || late.Ref == nil || late.Ref.Name != "db-0" {
		t.Errorf("a lone read stays a single row with its object: %+v", late)
	}
	if bob.User != "bob" || bob.Count != 0 {
		t.Errorf("bob's read is not part of alice's burst: %+v", bob)
	}
	if burst.User != "alice" || burst.Count != 25 || burst.Severity != "medium" || burst.Title != "Burst of Secret reads by a person" {
		t.Errorf("burst row = %+v", burst)
	}
	if burst.Detail != "25 reads of 3 Secrets: shop/db-0, shop/db-1, shop/db-2" || burst.FirstTime == "" || burst.Ref != nil || burst.Object != "secrets shop/*" {
		t.Errorf("burst detail = %q first=%q ref=%+v object=%q", burst.Detail, burst.FirstTime, burst.Ref, burst.Object)
	}
}

func TestAFewSecretReadsGroupWithoutBecomingABurst(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.log")
	writeLog(t, path, []string{
		secretRead("1", "carol", "a", "x", t0),
		secretRead("2", "carol", "b", "y", t0.Add(time.Minute)),
	})
	got, _ := ReadTail(path, 1<<20, 100)
	if len(got) != 1 || got[0].Count != 2 || got[0].Severity != "low" || got[0].Object != "secrets" || got[0].Detail != "2 reads of 2 Secrets: a/x, b/y" {
		t.Errorf("got %+v", got)
	}
}

func TestReadTailFollowsRotatedFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "audit.log")
	writeLog(t, path, []string{execAt("now", t0.Add(2*time.Hour))})
	writeLog(t, path+".1", []string{execAt("logrotate", t0.Add(time.Hour))})
	gz, err := os.Create(filepath.Join(dir, "audit-2026-10-01T09-00-00.000.log.gz"))
	if err != nil {
		t.Fatal(err)
	}
	zw := gzip.NewWriter(gz)
	_, _ = zw.Write([]byte(execAt("lumberjack", t0) + "\n"))
	_ = zw.Close()
	_ = gz.Close()
	writeLog(t, filepath.Join(dir, "other.log"), []string{execAt("unrelated", t0.Add(3*time.Hour))})

	got, err := ReadTail(path, 1<<20, 100)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, e := range got {
		ids = append(ids, e.ID)
	}
	if strings.Join(ids, ",") != "now,logrotate,lumberjack" {
		t.Errorf("ids = %v, want the live file then its rotations, newest first, and nothing from other files", ids)
	}
}

func TestReadTailStopsAtTheByteBudget(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "audit.log")
	line := execAt("now", t0.Add(time.Hour))
	writeLog(t, path, []string{line})
	writeLog(t, path+".1", []string{execAt("old", t0)})
	got, _ := ReadTail(path, int64(len(line)+1), 100)
	if len(got) != 1 || got[0].ID != "now" {
		t.Errorf("the live file alone fills the budget: %+v", got)
	}
}
