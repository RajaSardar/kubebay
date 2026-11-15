package proposals

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
)

// fakeCluster holds one Deployment and applies patches as JSON merge
// patches, honouring a metadata.resourceVersion precondition like the API
// server does.
type fakeCluster struct {
	mu      sync.Mutex
	obj     map[string]any
	rv      int
	patches []patchCall
	// raceStatus lands this many controller status writes between a
	// read and the next real (not dry-run) write.
	raceStatus int
}

type patchCall struct {
	patch  string
	dryRun bool
}

func newFake() *fakeCluster {
	return &fakeCluster{rv: 7, obj: map[string]any{
		"apiVersion": "apps/v1", "kind": "Deployment",
		"metadata": map[string]any{"name": "api", "namespace": "shop", "resourceVersion": "7", "uid": "u-1",
			"managedFields": []any{map[string]any{"manager": "helm"}}, "labels": map[string]any{"app": "api"}},
		"spec":   map[string]any{"replicas": float64(2), "template": map[string]any{"spec": map[string]any{"containers": []any{map[string]any{"name": "api", "image": "acme/api:1.4"}}}}},
		"status": map[string]any{"readyReplicas": float64(2)},
	}}
}

func clone(m map[string]any) map[string]any {
	b, _ := json.Marshal(m)
	var out map[string]any
	_ = json.Unmarshal(b, &out)
	return out
}

func merge(dst, patch map[string]any) {
	for k, v := range patch {
		if pm, ok := v.(map[string]any); ok {
			if dm, ok := dst[k].(map[string]any); ok {
				merge(dm, pm)
				continue
			}
		}
		if v == nil {
			delete(dst, k)
			continue
		}
		dst[k] = v
	}
}

func (f *fakeCluster) Get(_ context.Context, cluster, gvr, ns, name string) (map[string]any, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if gvr != "apps/v1/deployments" || ns != "shop" || name != "api" {
		return nil, apierrors.NewNotFound(schema.GroupResource{Resource: "deployments"}, name)
	}
	return clone(f.obj), nil
}

func (f *fakeCluster) Patch(_ context.Context, cluster, gvr, ns, name string, patch []byte, dryRun bool) (map[string]any, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.patches = append(f.patches, patchCall{string(patch), dryRun})
	var p map[string]any
	if err := json.Unmarshal(patch, &p); err != nil {
		return nil, err
	}
	if !dryRun && f.raceStatus > 0 {
		f.raceStatus--
		f.rv++
		f.obj["metadata"].(map[string]any)["resourceVersion"] = fmt.Sprint(f.rv)
	}
	if meta, _ := p["metadata"].(map[string]any); meta != nil {
		if want, ok := meta["resourceVersion"].(string); ok && want != fmt.Sprint(f.rv) {
			return nil, apierrors.NewConflict(schema.GroupResource{Group: "apps", Resource: "deployments"}, name, fmt.Errorf("the object has been modified"))
		}
	}
	next := clone(f.obj)
	merge(next, p)
	if dryRun {
		return next, nil
	}
	f.rv++
	next["metadata"].(map[string]any)["resourceVersion"] = fmt.Sprint(f.rv)
	f.obj = next
	return clone(next), nil
}

// statusUpdate is a controller writing status: the resourceVersion moves,
// nothing anyone reviewed does.
func (f *fakeCluster) statusUpdate() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rv++
	f.obj["metadata"].(map[string]any)["resourceVersion"] = fmt.Sprint(f.rv)
	f.obj["status"] = map[string]any{"readyReplicas": float64(1), "observedGeneration": float64(f.rv)}
}

// edit is someone else changing the spec.
func (f *fakeCluster) edit() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rv++
	f.obj["metadata"].(map[string]any)["resourceVersion"] = fmt.Sprint(f.rv)
	f.obj["spec"].(map[string]any)["paused"] = true
}

type harness struct {
	store   *Store
	cluster *fakeCluster
	now     time.Time
	entries []audit.Entry
}

func newHarness() *harness {
	h := &harness{cluster: newFake(), now: time.Date(2026, 10, 10, 10, 0, 0, 0, time.UTC)}
	h.store = New(h.cluster, func(e audit.Entry) { h.entries = append(h.entries, e) })
	h.store.now = func() time.Time { return h.now }
	return h
}

func scale(replicas int) Input {
	return Input{
		Cluster: "kind-dev", Kind: "deployments", GVR: "apps/v1/deployments", Namespace: "shop", Name: "api",
		Patch:  json.RawMessage(fmt.Sprintf(`{"spec":{"replicas":%d}}`, replicas)),
		Reason: "api is CPU-bound at 2 replicas", Client: "claude-code 2.1", RequestID: "9",
	}
}

func TestProposeDryRunsAndNeverMutates(t *testing.T) {
	h := newHarness()
	p, err := h.store.Propose(context.Background(), scale(4))
	if err != nil {
		t.Fatal(err)
	}
	if p.Status != StatusPending || p.ID == "" || p.ResourceVersion != "7" || !p.Expires.Equal(h.now.Add(5*time.Minute)) {
		t.Errorf("proposal = %+v", p)
	}
	if !strings.Contains(p.Diff, "-  replicas: 2") || !strings.Contains(p.Diff, "+  replicas: 4") {
		t.Errorf("diff:\n%s", p.Diff)
	}
	if strings.Contains(p.Diff, "managedFields") || strings.Contains(p.Diff, "readyReplicas") || strings.Contains(p.Diff, "resourceVersion") {
		t.Errorf("diff carries noise:\n%s", p.Diff)
	}
	if len(p.ChangedPaths) != 1 || p.ChangedPaths[0] != "spec.replicas" {
		t.Errorf("paths = %v", p.ChangedPaths)
	}
	for _, c := range h.cluster.patches {
		if !c.dryRun {
			t.Fatalf("propose must only dry-run: %+v", h.cluster.patches)
		}
	}
	if h.cluster.rv != 7 {
		t.Error("the object changed")
	}
	if len(h.entries) != 1 || h.entries[0].Action != "mcp:propose" || h.entries[0].Source != "mcp" || h.entries[0].Resource != "api" {
		t.Errorf("audit = %+v", h.entries)
	}
}

func TestProposalsThatCouldDoHarmAreRefused(t *testing.T) {
	h := newHarness()
	for _, patch := range []string{
		`{"metadata":{"name":"other"}}`,
		`{"metadata":{"namespace":"kube-system"}}`,
		`{"metadata":{"ownerReferences":[]}}`,
		`{"kind":"Pod"}`,
		`{"status":{"readyReplicas":9}}`,
		`{"spec":{"replicas":2}}`,
		`[1,2]`,
		`{}`,
	} {
		in := scale(2)
		in.Patch = json.RawMessage(patch)
		if _, err := h.store.Propose(context.Background(), in); err == nil {
			t.Errorf("%s accepted", patch)
		}
	}
	in := scale(3)
	in.Patch = json.RawMessage(`{"metadata":{"labels":{"tier":"web"}},"spec":{"replicas":3}}`)
	if _, err := h.store.Propose(context.Background(), in); err != nil {
		t.Errorf("labels and spec are fine: %v", err)
	}
}

func TestApprovingAppliesTheReviewedPatchOnce(t *testing.T) {
	h := newHarness()
	p, _ := h.store.Propose(context.Background(), scale(4))
	got, err := h.store.Approve(context.Background(), p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusApplied || h.cluster.obj["spec"].(map[string]any)["replicas"] != float64(4) {
		t.Errorf("approve = %+v, obj spec = %v", got, h.cluster.obj["spec"])
	}
	last := h.cluster.patches[len(h.cluster.patches)-1]
	if last.dryRun || !strings.Contains(last.patch, `"resourceVersion":"7"`) {
		t.Errorf("the apply carries the reviewed resourceVersion: %+v", last)
	}
	if _, err := h.store.Approve(context.Background(), p.ID); err == nil {
		t.Error("a proposal applies once")
	}
	e := h.entries[len(h.entries)-1]
	if e.Action != "mcp:apply-proposal" || e.Outcome != "" || !strings.Contains(e.Detail, "spec.replicas") || !strings.Contains(e.Detail, p.ID) {
		t.Errorf("audit = %+v", e)
	}
}

// The human reviewed a diff against the object's spec and metadata; if
// those changed since, applying would be applying something nobody reviewed.
func TestAChangedObjectMakesTheProposalStale(t *testing.T) {
	h := newHarness()
	p, _ := h.store.Propose(context.Background(), scale(4))
	h.cluster.edit()
	got, err := h.store.Approve(context.Background(), p.ID)
	if err == nil || got.Status != StatusStale || !strings.Contains(got.Message, "changed") {
		t.Errorf("approve = %+v, %v", got, err)
	}
	if h.cluster.obj["spec"].(map[string]any)["replicas"] != float64(2) {
		t.Error("nothing applied")
	}
}

func TestProposalsExpireAndAreAuditedOnce(t *testing.T) {
	h := newHarness()
	p, _ := h.store.Propose(context.Background(), scale(4))
	h.now = h.now.Add(5*time.Minute + time.Second)
	if got, _ := h.store.Get(p.ID); got.Status != StatusExpired {
		t.Errorf("status = %s", got.Status)
	}
	if _, err := h.store.Approve(context.Background(), p.ID); err == nil {
		t.Error("an expired proposal can't be approved")
	}
	h.store.Get(p.ID)
	n := 0
	for _, e := range h.entries {
		if e.Action == "mcp:proposal-expired" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("expired audited %d times", n)
	}
}

func TestRejectingAppliesNothing(t *testing.T) {
	h := newHarness()
	p, _ := h.store.Propose(context.Background(), scale(4))
	got, err := h.store.Reject(p.ID)
	if err != nil || got.Status != StatusRejected {
		t.Fatalf("reject = %+v, %v", got, err)
	}
	if h.cluster.rv != 7 || h.entries[len(h.entries)-1].Action != "mcp:reject-proposal" {
		t.Errorf("rv=%d audit=%+v", h.cluster.rv, h.entries)
	}
	if len(h.store.Pending()) != 0 {
		t.Error("nothing pending")
	}
}

func TestPendingIsBounded(t *testing.T) {
	h := newHarness()
	for i := 0; i < maxPending; i++ {
		if _, err := h.store.Propose(context.Background(), scale(3+i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.store.Propose(context.Background(), scale(99)); err == nil {
		t.Error("too many pending proposals accepted")
	}
	if ps := h.store.Pending(); len(ps) != maxPending || !ps[0].Created.Equal(h.now) {
		t.Errorf("pending = %d", len(ps))
	}
}

// The assistant's copy of the diff hides env values, as MCP's reads do;
// the person reviewing in Kubebay sees everything.
func TestTheAssistantsDiffHidesEnvValues(t *testing.T) {
	h := newHarness()
	h.cluster.obj["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)["containers"] = []any{
		map[string]any{"name": "api", "image": "acme/api:1.4", "env": []any{map[string]any{"name": "DB_PASSWORD", "value": "hunter2"}}},
	}
	in := scale(2)
	in.Patch = json.RawMessage(`{"spec":{"template":{"spec":{"containers":[{"name":"api","image":"acme/api:1.5","env":[{"name":"DB_PASSWORD","value":"hunter2"}]}]}}}}`)
	p, err := h.store.Propose(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(p.ModelDiff, "hunter2") || !strings.Contains(p.ModelDiff, "acme/api:1.5") || !strings.Contains(p.ModelDiff, "DB_PASSWORD") {
		t.Errorf("model diff:\n%s", p.ModelDiff)
	}
	if !strings.Contains(p.Diff, "hunter2") {
		t.Errorf("the reviewer's diff is complete:\n%s", p.Diff)
	}
}

func TestRejectAllClosesEverythingWaiting(t *testing.T) {
	h := newHarness()
	a, _ := h.store.Propose(context.Background(), scale(3))
	b, _ := h.store.Propose(context.Background(), scale(4))
	done, _ := h.store.Propose(context.Background(), scale(5))
	if _, err := h.store.Approve(context.Background(), done.ID); err != nil {
		t.Fatal(err)
	}
	if n := h.store.RejectAll("proposals were turned off in Kubebay"); n != 2 {
		t.Errorf("rejected %d", n)
	}
	for _, id := range []string{a.ID, b.ID} {
		if p, _ := h.store.Get(id); p.Status != StatusRejected || !strings.Contains(p.Message, "turned off") {
			t.Errorf("%s = %+v", id, p)
		}
	}
	if p, _ := h.store.Get(done.ID); p.Status != StatusApplied {
		t.Errorf("an applied proposal stays applied: %s", p.Status)
	}
}

// Controllers write status all the time, and every write moves the
// resourceVersion. That isn't a change anyone reviewed, so it mustn't make
// the proposal stale; the apply is pinned to the version just re-read.
func TestStatusUpdatesDontMakeAProposalStale(t *testing.T) {
	h := newHarness()
	p, _ := h.store.Propose(context.Background(), scale(4))
	h.cluster.statusUpdate()
	got, err := h.store.Approve(context.Background(), p.ID)
	if err != nil || got.Status != StatusApplied {
		t.Fatalf("approve = %+v, %v", got, err)
	}
	last := h.cluster.patches[len(h.cluster.patches)-1]
	if !strings.Contains(last.patch, `"resourceVersion":"8"`) {
		t.Errorf("the apply is pinned to the version re-read at approval: %s", last.patch)
	}
	if h.cluster.obj["spec"].(map[string]any)["replicas"] != float64(4) {
		t.Error("applied")
	}
}

// A controller writing status between the approval's read and its write is
// a 409 from the API server, not a change anyone reviewed: read again,
// check again, apply.
func TestAStatusWriteRacingTheApprovalIsRetried(t *testing.T) {
	h := newHarness()
	p, _ := h.store.Propose(context.Background(), scale(4))
	h.cluster.raceStatus = 2
	got, err := h.store.Approve(context.Background(), p.ID)
	if err != nil || got.Status != StatusApplied || h.cluster.obj["spec"].(map[string]any)["replicas"] != float64(4) {
		t.Fatalf("approve = %+v, %v", got, err)
	}
}

func TestAnEndlessRaceGivesUpStale(t *testing.T) {
	h := newHarness()
	p, _ := h.store.Propose(context.Background(), scale(4))
	h.cluster.raceStatus = 100
	got, err := h.store.Approve(context.Background(), p.ID)
	if err == nil || got.Status != StatusStale || h.cluster.obj["spec"].(map[string]any)["replicas"] != float64(2) {
		t.Fatalf("approve = %+v, %v", got, err)
	}
}
