package httpapi

import (
	"encoding/json"
	"testing"

	rcommon "helm.sh/helm/v4/pkg/release/common"
	releasev1 "helm.sh/helm/v4/pkg/release/v1"
)

// ADR 0004 S3: Helm returns history in the API server's order, which sorts
// revision names as text (v1, v10, v11, v2…). The drawer reads it newest
// first.
func TestHistoryIsNewestFirst(t *testing.T) {
	var rels []*releasev1.Release
	for v := 1; v <= 11; v++ {
		st := rcommon.StatusSuperseded
		if v == 11 {
			st = rcommon.StatusDeployed
		}
		rels = append(rels, webRelease(v, st))
	}
	rec := get(memoryHelm(t, rels...).HandleHistory, "/api/helm/history?cluster=c&ns=shop&name=web")
	var got []ReleaseSummary
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("%v: %s", err, rec.Body)
	}
	var revs []int
	for _, r := range got {
		revs = append(revs, r.Revision)
	}
	want := []int{11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1}
	if len(revs) != len(want) {
		t.Fatalf("history = %v, want %v", revs, want)
	}
	for i := range want {
		if revs[i] != want[i] {
			t.Fatalf("history = %v, want %v", revs, want)
		}
	}
}
