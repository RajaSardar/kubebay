package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
)

func connectRouter(sm *SettingsManager, authOn bool) http.Handler {
	r := chi.NewRouter()
	r.Post("/api/clusters/{id}/connect", connectClusterHandler(sm.mgr))
	r.Post("/api/clusters/{id}/disconnect", disconnectClusterHandler(sm.mgr, authOn))
	return r
}

func post(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, nil))
	return rec
}

func TestConnectAndDisconnectRoutes(t *testing.T) {
	sm := settingsWithManager(t)
	mgr := sm.mgr
	var torn []string
	mgr.OnDisconnect(func(id string) { torn = append(torn, id) })
	h := connectRouter(sm, false)

	rec := post(t, h, "/api/clusters/kind-dev/connect")
	if rec.Code != http.StatusOK {
		t.Fatalf("connect: %d %s", rec.Code, rec.Body)
	}
	var c clusters.Cluster
	_ = json.Unmarshal(rec.Body.Bytes(), &c)
	if c.ID != "kind-dev" || !c.Connected {
		t.Fatalf("connect returned %+v", c)
	}
	if rec := post(t, h, "/api/clusters/nope/connect"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown connect: %d", rec.Code)
	}

	if rec := post(t, h, "/api/clusters/kind-dev/disconnect"); rec.Code != http.StatusOK {
		t.Fatalf("disconnect: %d %s", rec.Code, rec.Body)
	}
	if mgr.IsConnected("kind-dev") || len(torn) != 1 {
		t.Errorf("disconnect did not tear down: connected=%v hooks=%v", mgr.IsConnected("kind-dev"), torn)
	}
	if rec := post(t, h, "/api/clusters/nope/disconnect"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown disconnect: %d", rec.Code)
	}
}

// With OIDC on, pools are shared between logged-in users: one user's
// Disconnect would cut everyone's streams.
func TestDisconnectIsDesktopOnly(t *testing.T) {
	sm := settingsWithManager(t)
	if rec := post(t, connectRouter(sm, true), "/api/clusters/kind-dev/disconnect"); rec.Code != http.StatusForbidden {
		t.Errorf("disconnect with OIDC on: %d, want 403", rec.Code)
	}
}

func TestOpeningAStreamConnectsTheCluster(t *testing.T) {
	sm := settingsWithManager(t)
	src := poolSource{reg: informers.NewPoolRegistry(sm.mgr), mgr: sm.mgr}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if _, err := src.Subscribe(ctx, "kind-dev", "v1/pods", nil, "", informers.ModeMetadata); err != nil {
		t.Fatal(err)
	}
	if !sm.mgr.IsConnected("kind-dev") {
		t.Error("subscribing must mark the cluster connected, so the engine's set is what is streaming")
	}
}

func TestStopClusterStopsOnlyThatClustersForwards(t *testing.T) {
	p := &PFManager{m: map[string]*pfEntry{
		"a": {fw: PortForward{ID: "a", Cluster: "c1"}, stop: make(chan struct{})},
		"b": {fw: PortForward{ID: "b", Cluster: "c2"}, stop: make(chan struct{})},
	}}
	stopA := p.m["a"].stop
	p.StopCluster("c1")
	select {
	case <-stopA:
	default:
		t.Error("c1's forward was not stopped")
	}
	if got := p.List(context.Background()); len(got) != 1 || got[0].Cluster != "c2" {
		t.Errorf("remaining forwards = %+v", got)
	}
}
