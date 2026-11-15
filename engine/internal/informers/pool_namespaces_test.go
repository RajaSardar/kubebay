package informers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// A subscription over several namespaces is one stream: it reaches the client
// as one snapshot holding every namespace (ARCHITECTURE.md: one sync per
// subscription), and a namespace RBAC refuses is named on its own while the
// others stay live.

func deployment(ns, name string) map[string]any {
	return map[string]any{
		"apiVersion": "apps/v1",
		"kind":       "Deployment",
		"metadata":   map[string]any{"name": name, "namespace": ns, "uid": ns + "-" + name, "resourceVersion": "3"},
	}
}

// fakeDeployments is an API server for apps/v1 deployments, per namespace:
// a namespace in items is served (list, watch-list and watch), one missing
// from it answers 403. events[ns] pushes watch events after the initial load.
type fakeDeployments struct {
	items  map[string][]map[string]any
	events map[string]chan map[string]any
}

func (f fakeDeployments) serve(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// /apis/apps/v1/namespaces/<ns>/deployments
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		ns := ""
		if len(parts) == 6 && parts[3] == "namespaces" {
			ns = parts[4]
		}
		items, ok := f.items[ns]
		w.Header().Set("Content-Type", "application/json")
		if !ok {
			w.WriteHeader(http.StatusForbidden)
			msg := fmt.Sprintf(`deployments.apps is forbidden: User "dev" cannot list resource "deployments" in API group "apps" in the namespace %q`, ns)
			_ = json.NewEncoder(w).Encode(map[string]any{"kind": "Status", "apiVersion": "v1", "status": "Failure", "reason": "Forbidden", "code": 403, "message": msg})
			return
		}
		q := r.URL.Query()
		if q.Get("watch") != "true" && q.Get("watch") != "1" {
			_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "apps/v1", "kind": "DeploymentList", "metadata": map[string]any{"resourceVersion": "5"}, "items": items})
			return
		}
		fl := w.(http.Flusher)
		enc := json.NewEncoder(w)
		if q.Get("sendInitialEvents") == "true" {
			for _, it := range items {
				_ = enc.Encode(map[string]any{"type": "ADDED", "object": it})
			}
			_ = enc.Encode(map[string]any{"type": "BOOKMARK", "object": map[string]any{
				"apiVersion": "apps/v1", "kind": "Deployment",
				"metadata": map[string]any{"resourceVersion": "5", "annotations": map[string]any{"k8s.io/initial-events-end": "true"}},
			}})
		}
		fl.Flush()
		for {
			select {
			case <-r.Context().Done():
				return
			case obj := <-f.events[ns]:
				_ = enc.Encode(map[string]any{"type": "ADDED", "object": obj})
				fl.Flush()
			}
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func names(ops []stream.Op) []string {
	var out []string
	for _, op := range ops {
		if md, ok := op.Obj["metadata"].(map[string]any); ok {
			out = append(out, fmt.Sprintf("%v/%v", md["namespace"], md["name"]))
		}
	}
	sort.Strings(out)
	return out
}

func subscribeFake(t *testing.T, f fakeDeployments, namespaces ...string) *Subscription {
	t.Helper()
	p, err := New(&rest.Config{Host: f.serve(t).URL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	sub, err := p.Subscribe(context.Background(), "apps/v1/deployments", namespaces, "", ModeFull)
	if err != nil {
		t.Fatal(err)
	}
	return sub
}

func TestSeveralNamespacesArriveAsOneSnapshot(t *testing.T) {
	sub := subscribeFake(t, fakeDeployments{items: map[string][]map[string]any{
		"shop":     {deployment("shop", "api"), deployment("shop", "web")},
		"payments": {deployment("payments", "gateway")},
	}}, "shop", "payments")

	select {
	case snap := <-sub.Snapshot():
		if got, want := names(snap.All()), []string{"payments/gateway", "shop/api", "shop/web"}; fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("snapshot = %v, want %v: every namespace in one snapshot", got, want)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no snapshot")
	}
	select {
	case snap := <-sub.Snapshot():
		t.Fatalf("a second snapshot %v: the client would replace the first with it", names(snap.All()))
	case <-time.After(time.Second):
	}
}

func TestARefusedNamespaceNamesItselfAndTheOthersStayLive(t *testing.T) {
	events := map[string]chan map[string]any{"shop": make(chan map[string]any, 1)}
	sub := subscribeFake(t, fakeDeployments{
		items:  map[string][]map[string]any{"shop": {deployment("shop", "api")}},
		events: events,
	}, "shop", "payments")

	select {
	case d := <-sub.Denials():
		if d.NS != "payments" || !strings.Contains(d.Message, `in the namespace "payments"`) {
			t.Fatalf("denial = %+v, want payments with the API server's message", d)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no denial for payments")
	}
	select {
	case snap := <-sub.Snapshot():
		if got := names(snap.All()); fmt.Sprint(got) != "[shop/api]" {
			t.Fatalf("snapshot = %v, want shop's rows", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no snapshot for shop")
	}
	if sub.CloseReason() != "" {
		t.Fatalf("subscription ended (%q): shop must stay live", sub.CloseReason())
	}

	events["shop"] <- deployment("shop", "cart")
	deadline := time.After(5 * time.Second)
	for {
		select {
		case ops, ok := <-sub.Deltas():
			if !ok {
				t.Fatal("deltas closed")
			}
			if fmt.Sprint(names(ops)) == "[shop/cart]" {
				return
			}
		case <-deadline:
			t.Fatal("no delta from shop after payments was refused")
		}
	}
}

func TestEveryNamespaceRefusedEndsTheSubscription(t *testing.T) {
	sub := subscribeFake(t, fakeDeployments{items: map[string][]map[string]any{}}, "shop", "payments")
	select {
	case _, ok := <-sub.Deltas():
		if ok {
			t.Fatal("got a delta from refused namespaces")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("subscription still open with every namespace refused")
	}
	if !strings.HasPrefix(sub.CloseReason(), stream.ReasonForbidden) {
		t.Fatalf("reason = %q, want it to start with %q", sub.CloseReason(), stream.ReasonForbidden)
	}
}
