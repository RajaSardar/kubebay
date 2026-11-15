// Package proposals is MCP phase 2 (backlog #5): an assistant may propose a
// change, never make one. propose_change dry-runs a strategic merge patch
// and records the diff; a person approves or rejects it in Kubebay; only an
// approval applies it, conditional on the object being exactly the version
// that was reviewed. Proposals expire after five minutes, and every step is
// audited.
package proposals

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/redact"
)

type Status string

const (
	StatusPending  Status = "pending"
	StatusApplying Status = "applying"
	StatusApplied  Status = "applied"
	StatusRejected Status = "rejected"
	StatusExpired  Status = "expired"
	// StatusStale: the object changed after the diff was reviewed.
	StatusStale  Status = "stale"
	StatusFailed Status = "failed"
)

const (
	TTL        = 5 * time.Minute
	maxPending = 20
	// keepDecided bounds how many finished proposals stay for status lookups.
	keepDecided = 50
	maxReason   = 500
)

// Patcher reads an object and applies a strategic merge patch to it, as the
// engine's own field manager. A dry run changes nothing.
type Patcher interface {
	Get(ctx context.Context, cluster, gvr, ns, name string) (map[string]any, error)
	Patch(ctx context.Context, cluster, gvr, ns, name string, patch []byte, dryRun bool) (map[string]any, error)
}

// Input is one propose_change call, already checked against MCP scope.
type Input struct {
	Cluster   string
	Kind      string
	GVR       string
	Namespace string
	Name      string
	Patch     json.RawMessage
	Reason    string
	Client    string
	RequestID string
}

type Proposal struct {
	ID        string          `json:"id"`
	Cluster   string          `json:"cluster"`
	Kind      string          `json:"kind"`
	GVR       string          `json:"-"`
	Namespace string          `json:"namespace"`
	Name      string          `json:"name"`
	Patch     json.RawMessage `json:"patch"`
	Reason    string          `json:"reason,omitempty"`
	Client    string          `json:"client,omitempty"`
	// ResourceVersion is the object version the diff was computed against.
	// An approval applies only while the object's spec and metadata still
	// match it; status writes don't count.
	ResourceVersion string `json:"resourceVersion"`
	// Diff is for the person reviewing it in Kubebay.
	Diff string `json:"diff"`
	// ModelDiff is what the assistant sees: env values redacted, credentials
	// masked, like every other MCP read.
	ModelDiff    string     `json:"-"`
	ChangedPaths []string   `json:"changedPaths"`
	Status       Status     `json:"status"`
	Message      string     `json:"message,omitempty"`
	Created      time.Time  `json:"created"`
	Expires      time.Time  `json:"expires"`
	Decided      *time.Time `json:"decided,omitempty"`
	requestID    string
	// reviewed is the cleaned object the diff was computed from.
	reviewed string
}

type Store struct {
	mu      sync.Mutex
	items   map[string]*Proposal
	patcher Patcher
	audit   func(audit.Entry)
	now     func() time.Time
}

func New(p Patcher, auditFn func(audit.Entry)) *Store {
	if auditFn == nil {
		auditFn = func(audit.Entry) {}
	}
	return &Store{items: map[string]*Proposal{}, patcher: p, audit: auditFn, now: time.Now}
}

// validatePatch allows spec and metadata labels/annotations only: no
// identity, owner, finalizer or status changes.
func validatePatch(raw json.RawMessage) (map[string]any, error) {
	var p map[string]any
	if err := json.Unmarshal(raw, &p); err != nil || p == nil {
		return nil, errors.New("patch must be a JSON object, such as {\"spec\":{\"replicas\":3}}")
	}
	if len(p) == 0 {
		return nil, errors.New("patch is empty")
	}
	for k, v := range p {
		switch k {
		case "spec":
		case "metadata":
			m, ok := v.(map[string]any)
			if !ok {
				return nil, errors.New("metadata must be an object")
			}
			for mk := range m {
				if mk != "labels" && mk != "annotations" {
					return nil, fmt.Errorf("only metadata.labels and metadata.annotations can be changed, not metadata.%s", mk)
				}
			}
		default:
			return nil, fmt.Errorf("only spec and metadata labels/annotations can be changed, not %s", k)
		}
	}
	return p, nil
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "p-" + hex.EncodeToString(b)
}

func resourceVersion(o map[string]any) string {
	m, _ := o["metadata"].(map[string]any)
	s, _ := m["resourceVersion"].(string)
	return s
}

func (s *Store) record(p *Proposal, action, detail, outcome string) {
	s.audit(audit.Entry{
		Time:      s.now(),
		Action:    action,
		Cluster:   p.Cluster,
		Namespace: p.Namespace,
		Resource:  p.Name,
		Detail:    fmt.Sprintf("id=%s kind=%s fields=%s request=%s%s", p.ID, p.Kind, strings.Join(p.ChangedPaths, ","), p.requestID, detail),
		UserAgent: p.Client,
		Outcome:   outcome,
		Source:    "mcp",
	})
}

// expireLocked marks an overdue pending proposal expired, auditing it once.
func (s *Store) expireLocked(p *Proposal) {
	if p.Status != StatusPending || !s.now().After(p.Expires) {
		return
	}
	now := s.now()
	p.Status, p.Decided, p.Message = StatusExpired, &now, "nobody approved it within five minutes"
	s.record(p, "mcp:proposal-expired", "", "expired")
}

// pruneLocked drops the oldest finished proposals past keepDecided.
func (s *Store) pruneLocked() {
	var done []*Proposal
	for _, p := range s.items {
		if p.Decided != nil {
			done = append(done, p)
		}
	}
	if len(done) <= keepDecided {
		return
	}
	sort.Slice(done, func(i, j int) bool { return done[i].Decided.Before(*done[j].Decided) })
	for _, p := range done[:len(done)-keepDecided] {
		delete(s.items, p.ID)
	}
}

// Propose dry-runs the patch and records a pending proposal. It never
// changes the object.
func (s *Store) Propose(ctx context.Context, in Input) (Proposal, error) {
	patch, err := validatePatch(in.Patch)
	if err != nil {
		return Proposal{}, err
	}
	s.mu.Lock()
	pending := 0
	for _, p := range s.items {
		s.expireLocked(p)
		if p.Status == StatusPending {
			pending++
		}
	}
	s.mu.Unlock()
	if pending >= maxPending {
		return Proposal{}, fmt.Errorf("%d proposals are already waiting for a decision in Kubebay; wait for them first", pending)
	}
	live, err := s.patcher.Get(ctx, in.Cluster, in.GVR, in.Namespace, in.Name)
	if err != nil {
		return Proposal{}, err
	}
	body, _ := json.Marshal(patch)
	result, err := s.patcher.Patch(ctx, in.Cluster, in.GVR, in.Namespace, in.Name, body, true)
	if err != nil {
		return Proposal{}, fmt.Errorf("the API server refused the change in a dry run: %w", err)
	}
	before, after := clean(live), clean(result)
	paths := changedPaths(before, after)
	if len(paths) == 0 {
		return Proposal{}, fmt.Errorf("that patch changes nothing on %s %s/%s", in.Kind, in.Namespace, in.Name)
	}
	modelDiff, _ := redact.String(lineDiff(toYAML(redactEnv(before)), toYAML(redactEnv(after))))
	reason := strings.TrimSpace(in.Reason)
	if len(reason) > maxReason {
		reason = reason[:maxReason] + "…"
	}
	now := s.now()
	p := &Proposal{
		ID: newID(), Cluster: in.Cluster, Kind: in.Kind, GVR: in.GVR, Namespace: in.Namespace, Name: in.Name,
		Patch: body, Reason: reason, Client: in.Client, ResourceVersion: resourceVersion(live),
		Diff: lineDiff(toYAML(before), toYAML(after)), ModelDiff: modelDiff, ChangedPaths: paths,
		Status: StatusPending, Created: now, Expires: now.Add(TTL), requestID: in.RequestID,
		reviewed: canonical(before),
	}
	s.mu.Lock()
	s.items[p.ID] = p
	s.pruneLocked()
	out := *p
	s.mu.Unlock()
	s.record(p, "mcp:propose", "", "")
	return out, nil
}

// Get returns a proposal as it stands now.
func (s *Store) Get(id string) (Proposal, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.items[id]
	if !ok {
		return Proposal{}, false
	}
	s.expireLocked(p)
	return *p, true
}

// Pending lists proposals waiting for a decision, oldest first.
func (s *Store) Pending() []Proposal {
	return s.list(func(p *Proposal) bool { return p.Status == StatusPending || p.Status == StatusApplying })
}

// Recent lists every proposal still held, newest first.
func (s *Store) Recent() []Proposal {
	out := s.list(func(*Proposal) bool { return true })
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

func (s *Store) list(keep func(*Proposal) bool) []Proposal {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Proposal{}
	for _, p := range s.items {
		s.expireLocked(p)
		if keep(p) {
			out = append(out, *p)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].Created.Equal(out[j].Created) {
			return out[i].Created.Before(out[j].Created)
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// claim moves a pending proposal to next, or says why it can't.
func (s *Store) claim(id string, next Status) (*Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.items[id]
	if !ok {
		return nil, fmt.Errorf("no proposal %s", id)
	}
	s.expireLocked(p)
	if p.Status != StatusPending {
		return nil, fmt.Errorf("proposal %s is %s", id, p.Status)
	}
	p.Status = next
	return p, nil
}

func (s *Store) finish(p *Proposal, st Status, msg string) Proposal {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	p.Status, p.Message, p.Decided = st, msg, &now
	return *p
}

func canonical(o map[string]any) string {
	b, _ := json.Marshal(o) // map keys marshal sorted
	return string(b)
}

const staleMessage = "the object changed after this proposal was made, so it wasn't applied; ask the assistant to propose again"

// applyAttempts bounds re-reads when status writes race the approval.
const applyAttempts = 5

// Approve applies the reviewed patch, only while the object's spec and
// metadata are still what the diff was computed from. Controllers write
// status constantly, which moves the resourceVersion without changing
// anything reviewed, so the check compares content and each write is pinned
// to the version just read; a 409 from a status write landing in between
// means read and check again.
func (s *Store) Approve(ctx context.Context, id string) (Proposal, error) {
	p, err := s.claim(id, StatusApplying)
	if err != nil {
		return Proposal{}, err
	}
	var patch map[string]any
	_ = json.Unmarshal(p.Patch, &patch)
	meta, _ := patch["metadata"].(map[string]any)
	if meta == nil {
		meta = map[string]any{}
	}
	patch["metadata"] = meta
	for attempt := 1; ; attempt++ {
		live, err := s.patcher.Get(ctx, p.Cluster, p.GVR, p.Namespace, p.Name)
		if err != nil {
			out := s.finish(p, StatusFailed, err.Error())
			s.record(p, "mcp:apply-proposal", " error="+err.Error(), "failed")
			return out, err
		}
		if canonical(clean(live)) != p.reviewed {
			out := s.finish(p, StatusStale, staleMessage)
			s.record(p, "mcp:apply-proposal", "", "stale")
			return out, errors.New(out.Message)
		}
		// A resourceVersion in the patch makes it conditional: the API
		// server answers 409 if the object changes between that read and
		// this write.
		meta["resourceVersion"] = resourceVersion(live)
		body, _ := json.Marshal(patch)
		res, err := s.patcher.Patch(ctx, p.Cluster, p.GVR, p.Namespace, p.Name, body, false)
		switch {
		case apierrors.IsConflict(err) && attempt < applyAttempts:
			select {
			case <-ctx.Done():
				out := s.finish(p, StatusFailed, ctx.Err().Error())
				s.record(p, "mcp:apply-proposal", " error="+ctx.Err().Error(), "failed")
				return out, ctx.Err()
			case <-time.After(time.Duration(attempt) * 25 * time.Millisecond):
			}
			continue
		case apierrors.IsConflict(err):
			out := s.finish(p, StatusStale, staleMessage)
			s.record(p, "mcp:apply-proposal", fmt.Sprintf(" conflicts=%d", attempt), "stale")
			return out, errors.New(out.Message)
		case err != nil:
			out := s.finish(p, StatusFailed, err.Error())
			s.record(p, "mcp:apply-proposal", " error="+err.Error(), "failed")
			return out, err
		}
		out := s.finish(p, StatusApplied, "applied; the object is now at resourceVersion "+resourceVersion(res))
		s.record(p, "mcp:apply-proposal", "", "")
		return out, nil
	}
}

// Reject closes a proposal without applying it.
func (s *Store) Reject(id string) (Proposal, error) {
	p, err := s.claim(id, StatusRejected)
	if err != nil {
		return Proposal{}, err
	}
	out := s.finish(p, StatusRejected, "rejected in Kubebay")
	s.record(p, "mcp:reject-proposal", "", "rejected")
	return out, nil
}

// RejectAll closes every pending proposal, as the kill switch does.
func (s *Store) RejectAll(msg string) int {
	s.mu.Lock()
	var pending []*Proposal
	for _, p := range s.items {
		s.expireLocked(p)
		if p.Status == StatusPending {
			p.Status = StatusRejected
			pending = append(pending, p)
		}
	}
	s.mu.Unlock()
	for _, p := range pending {
		s.finish(p, StatusRejected, msg)
		s.record(p, "mcp:reject-proposal", " reason=turned-off", "rejected")
	}
	return len(pending)
}
