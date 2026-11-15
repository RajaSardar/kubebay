package informers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

const forbiddenMsg = `deployments.apps is forbidden: User "dev" cannot list resource "deployments" in API group "apps" at the cluster scope`

// forbiddingServer is an API server that answers every request 403, as one
// does when RBAC doesn't let you list a resource.
func forbiddingServer(t *testing.T) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403,"message":` + quote(forbiddenMsg) + `}`))
	}))
	t.Cleanup(srv.Close)
	return srv, &hits
}

func quote(s string) string { return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"` }

func endedWithin(t *testing.T, sub *Subscription, d time.Duration) {
	t.Helper()
	select {
	case _, ok := <-sub.Deltas():
		if ok {
			t.Fatal("got a delta from a forbidden list")
		}
	case <-time.After(d):
		t.Fatal("subscription still open: a forbidden list keeps the page waiting")
	}
}

// A list RBAC forbids ends the subscription with the API server's reason
// instead of retrying forever while the page waits for a sync, and the
// informer stops asking.
func TestForbiddenListEndsTheSubscriptionWithTheReason(t *testing.T) {
	srv, hits := forbiddingServer(t)
	p, err := New(&rest.Config{Host: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)

	sub, err := p.Subscribe(context.Background(), "apps/v1/deployments", nil, "", ModeFull)
	if err != nil {
		t.Fatal(err)
	}
	endedWithin(t, sub, 5*time.Second)
	if want := stream.ReasonForbidden + forbiddenMsg; sub.CloseReason() != want {
		t.Fatalf("reason = %q, want %q", sub.CloseReason(), want)
	}

	asked := hits.Load()
	time.Sleep(2 * time.Second)
	if hits.Load() != asked {
		t.Errorf("informer kept listing after the 403: %d more requests", hits.Load()-asked)
	}

	// Once RBAC changes, opening the page again must try again.
	again, err := p.Subscribe(context.Background(), "apps/v1/deployments", nil, "", ModeFull)
	if err != nil {
		t.Fatal(err)
	}
	endedWithin(t, again, 5*time.Second)
	if hits.Load() == asked {
		t.Error("a new subscription reused the forbidden informer instead of listing again")
	}
}
