package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/fleet"
)

func fleetManager(t *testing.T, server string) *clusters.Manager {
	t.Helper()
	kc := filepath.Join(t.TempDir(), "kubeconfig")
	cfg := "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: " + server + "\ncontexts:\n- name: kind-dev\n  context:\n    cluster: c\n    user: u\nusers:\n- name: u\n  user: {token: t}\ncurrent-context: kind-dev\n"
	if err := os.WriteFile(kc, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	mgr, err := clusters.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), kc)
	if err != nil {
		t.Fatal(err)
	}
	return mgr
}

func postSummary(t *testing.T, h http.Handler, body string) []fleet.Summary {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/clusters/summary", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("summary: %d %s", rec.Code, rec.Body)
	}
	var out struct {
		Summaries []fleet.Summary `json:"summaries"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Summaries
}

func TestFleetSummaryRouteSummarisesWithoutConnecting(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/version":
			_, _ = w.Write([]byte(`{"gitVersion":"v1.31.0"}`))
		case "/api/v1/nodes":
			_, _ = w.Write([]byte(`{"kind":"NodeList","apiVersion":"v1","metadata":{},"items":[{"metadata":{"name":"a"},"status":{"conditions":[{"type":"Ready","status":"True"}]}},{"metadata":{"name":"b"},"status":{"conditions":[{"type":"Ready","status":"Unknown"}]}}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer api.Close()
	mgr := fleetManager(t, api.URL)
	sum := fleet.New(fleet.Options{})
	h := fleetSummaryHandler(mgr, sum)

	first := postSummary(t, h, `{"ids":["kind-dev","nope"]}`)
	if len(first) != 2 || !first[0].Pending {
		t.Fatalf("first answer: %+v", first)
	}
	if first[1].Status != fleet.StatusMisconfigured {
		t.Errorf("unknown cluster: %+v", first[1])
	}
	sum.Wait()
	got := postSummary(t, h, `{"ids":["kind-dev"]}`)[0]
	if got.Pending || got.Version != "v1.31.0" || got.Nodes == nil || *got.Nodes != 2 || *got.ReadyNodes != 1 {
		t.Fatalf("summary: %+v", got)
	}
	if mgr.IsConnected("kind-dev") {
		t.Error("a summary must not connect the cluster (it would count against the warm cap)")
	}
}

func TestFleetSummaryRouteRejectsBadBody(t *testing.T) {
	h := fleetSummaryHandler(fleetManager(t, "https://127.0.0.1:1"), fleet.New(fleet.Options{}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/clusters/summary", strings.NewReader("{")))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad body: %d", rec.Code)
	}
}
