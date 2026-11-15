package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/netguard"
)

// The engine fetches URLs a user typed in: a Prometheus endpoint, a Helm repository.
// Those must not reach a cloud metadata service, and in a shared in-cluster
// deployment not the engine's own loopback either.

func saveRaw(sm *SettingsManager, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	sm.HandleSave(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(body)))
	return rec
}

func TestSaveRefusesAPrometheusURLThatReachesCloudMetadata(t *testing.T) {
	for _, body := range []string{
		`{"prometheusUrl":"http://169.254.169.254/latest/meta-data/"}`,
		`{"prometheusUrls":{"prod":"http://169.254.169.254/"}}`,
		`{"prometheusUrl":"file:///etc/passwd"}`,
	} {
		sm := settingsWithManager(t)
		rec := saveRaw(sm, body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", body, rec.Code)
		}
		if set, _ := sm.Load(); set.PrometheusURL != "" || len(set.PrometheusURLs) != 0 {
			t.Errorf("%s: was stored anyway: %+v", body, set)
		}
	}
}

func TestSaveStillAcceptsALocalPrometheusOnADesktop(t *testing.T) {
	sm := settingsWithManager(t)
	if rec := saveRaw(sm, `{"prometheusUrl":"http://localhost:9090","prometheusUrls":{"kind-dev":"http://127.0.0.1:9090"}}`); rec.Code != http.StatusOK {
		t.Fatalf("a port-forwarded Prometheus was refused on a desktop: %d %s", rec.Code, rec.Body)
	}
}

func TestSaveRefusesALoopbackPrometheusInCluster(t *testing.T) {
	sm := settingsWithManager(t)
	sm.Outbound = netguard.Policy{BlockLoopback: true}
	if rec := saveRaw(sm, `{"prometheusUrl":"http://127.0.0.1:8080"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("in-cluster accepted the engine's own loopback: %d", rec.Code)
	}
	// An in-cluster Prometheus Service is a private address, which stays fine.
	if rec := saveRaw(sm, `{"prometheusUrl":"http://10.96.12.4:9090"}`); rec.Code != http.StatusOK {
		t.Errorf("in-cluster refused a private Prometheus address: %d %s", rec.Code, rec.Body)
	}
}

func TestThePrometheusProxyChecksTheAddressItConnectsToNotJustTheSavedURL(t *testing.T) {
	var hits atomic.Int32
	prom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { hits.Add(1) }))
	defer prom.Close()

	// The URL is already in the settings file (an older version, or a hand edit),
	// so saving never had the chance to refuse it.
	sm := settingsManagerWithPrometheus(t, prom.URL)
	sm.Outbound = netguard.Policy{BlockLoopback: true}

	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=c&query=up", nil))
	if hits.Load() != 0 {
		t.Fatalf("the engine connected to a blocked address %d time(s)", hits.Load())
	}
	if rec.Code != http.StatusBadGateway {
		t.Errorf("status %d, want 502", rec.Code)
	}
}

func TestAddingAHelmRepoRefusesMetadataAndInClusterLoopback(t *testing.T) {
	post := func(h *HelmManager, url string) int {
		rec := httptest.NewRecorder()
		h.HandleAddRepo(rec, httptest.NewRequest(http.MethodPost, "/api/helm/repos/add", strings.NewReader(`{"name":"x","url":"`+url+`"}`)))
		return rec.Code
	}
	if code := post(&HelmManager{}, "http://169.254.169.254/charts"); code != http.StatusBadRequest {
		t.Errorf("metadata URL: status %d, want 400", code)
	}
	if code := post(&HelmManager{Outbound: netguard.Policy{BlockLoopback: true}}, "http://127.0.0.1:8080/charts"); code != http.StatusBadRequest {
		t.Errorf("in-cluster loopback URL: status %d, want 400", code)
	}
}
