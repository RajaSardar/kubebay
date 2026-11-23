package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/fleet"
)

func postColdSearch(t *testing.T, h http.Handler, body string, ident *clusters.Identity) (int, fleet.SearchResult) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/search/clusters", strings.NewReader(body))
	if ident != nil {
		req = req.WithContext(clusters.WithIdentity(req.Context(), ident))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out fleet.SearchResult
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("Cache-Control %q", got)
		}
	}
	return rec.Code, out
}

func TestColdSearchRouteSearchesWithoutConnecting(t *testing.T) {
	var impersonated atomic.Value
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		impersonated.Store(r.Header.Get("Impersonate-User"))
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/apis/apps/v1/deployments" {
			_, _ = w.Write([]byte(`{"kind":"PartialObjectMetadataList","apiVersion":"meta.k8s.io/v1","metadata":{},"items":[{"metadata":{"name":"checkout","namespace":"shop"}}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer api.Close()
	mgr := fleetManager(t, api.URL)
	s := fleet.NewSearcher(fleet.Options{})
	h := coldSearchHandler(mgr, s)
	alice := &clusters.Identity{Name: "alice@example.com"}

	code, first := postColdSearch(t, h, `{"ids":["kind-dev","nope"],"q":"deploy check"}`, alice)
	if code != http.StatusOK || len(first.Clusters) != 2 {
		t.Fatalf("first answer: %d %+v", code, first)
	}
	s.Wait()
	_, got := postColdSearch(t, h, `{"ids":["kind-dev"],"q":"deploy check"}`, alice)
	if len(got.Hits) != 1 || got.Hits[0].Cluster != "kind-dev" || got.Hits[0].Name != "checkout" || got.Hits[0].NS != "shop" || got.Hits[0].Kind != "Deployments" {
		t.Fatalf("hits: %+v", got)
	}
	if v, _ := impersonated.Load().(string); v != "alice@example.com" {
		t.Errorf("lists must run as the signed-in user, Impersonate-User was %q", v)
	}
	if mgr.IsConnected("kind-dev") {
		t.Error("a search must not connect the cluster (it would count against the warm cap)")
	}
}

func TestColdSearchIsRoutedBehindTheToken(t *testing.T) {
	h := Router(Deps{Clusters: fleetManager(t, "https://127.0.0.1:1")}, "secret")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/search/clusters", strings.NewReader(`{"ids":[],"q":"api"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("without the token: %d", rec.Code)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/search/clusters", strings.NewReader(`{"ids":[],"q":"api"}`))
	req.Header.Set("X-Kubebay-Token", "secret")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("with the token: %d %s", rec.Code, rec.Body)
	}
}

func TestColdSearchRouteRejectsBadRequests(t *testing.T) {
	h := coldSearchHandler(fleetManager(t, "https://127.0.0.1:1"), fleet.NewSearcher(fleet.Options{}))
	for _, body := range []string{"{", `{"ids":["a"]}`, `{"ids":["a"],"q":"` + strings.Repeat("x", 201) + `"}`} {
		if code, _ := postColdSearch(t, h, body, nil); code != http.StatusBadRequest {
			t.Errorf("%.40s: %d", body, code)
		}
	}
}
