package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/client-go/kubernetes/scheme"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/waste"
)

// Internal security review: with OIDC, state the engine holds or collects
// under its own identity must not reach a user beyond their RBAC, and one
// user must not be able to change what runs on another user's behalf.

var (
	alice = &clusters.Identity{Name: "alice", Groups: []string{"shop-devs"}}
	bob   = &clusters.Identity{Name: "bob", Groups: []string{"platform"}}
)

func signedIn(r *http.Request, who *clusters.Identity) *http.Request {
	return r.WithContext(clusters.WithIdentity(r.Context(), who))
}

// ssarServer answers SelfSubjectAccessReviews for "list pods": allowed[user]
// holds the namespaces that user may list pods in, "*" meaning every one.
type ssarServer struct {
	*httptest.Server
	mu      sync.Mutex
	allowed map[string][]string
	fail    bool
	reviews []string
}

func newSSARServer(t *testing.T, allowed map[string][]string) *ssarServer {
	t.Helper()
	s := &ssarServer{allowed: allowed}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/selfsubjectaccessreviews") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"major":"1","minor":"30","gitVersion":"v1.30.0"}`))
			return
		}
		var review authorizationv1.SelfSubjectAccessReview
		raw, _ := io.ReadAll(r.Body)
		if _, _, err := scheme.Codecs.UniversalDeserializer().Decode(raw, nil, &review); err != nil || review.Spec.ResourceAttributes == nil {
			s.mu.Lock()
			s.reviews = append(s.reviews, "bad:"+r.Header.Get("Content-Type"))
			s.mu.Unlock()
			http.Error(w, "bad review", http.StatusBadRequest)
			return
		}
		user := r.Header.Get("Impersonate-User")
		ra := review.Spec.ResourceAttributes
		s.mu.Lock()
		s.reviews = append(s.reviews, user+":"+ra.Verb+":"+ra.Resource+":"+ra.Namespace)
		fail := s.fail
		s.mu.Unlock()
		if fail {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		ok := false
		if ra.Verb == "list" && ra.Resource == "pods" && ra.Group == "" {
			for _, ns := range s.allowed[user] {
				if ns == "*" || (ra.Namespace != "" && ns == ra.Namespace) {
					ok = true
				}
			}
		}
		review.Status.Allowed = ok
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(review)
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *ssarServer) count() int { s.mu.Lock(); defer s.mu.Unlock(); return len(s.reviews) }

func managerFor(t *testing.T, server string) *clusters.Manager {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	kc := filepath.Join(home, "kubeconfig")
	cfg := "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: " + server + "\ncontexts:\n- name: dev\n  context: {cluster: c, user: u}\nusers:\n- name: u\n  user: {token: t}\ncurrent-context: dev\n"
	if err := os.WriteFile(kc, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	mgr, err := clusters.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), kc)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mgr.Close)
	return mgr
}

var everyNamespace = fakeSnapshotter{byCluster: map[string][]waste.WorkloadWaste{"dev": {
	{Cluster: "dev", Ns: "shop", Kind: "Deployment", Name: "cart"},
	{Cluster: "dev", Ns: "payments", Kind: "Deployment", Name: "ledger"},
	{Cluster: "dev", Ns: "kube-system", Kind: "DaemonSet", Name: "cni"},
}}}

func wasteNamespaces(t *testing.T, h http.HandlerFunc, who *clusters.Identity) []string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/waste/workloads?cluster=dev", nil)
	if who != nil {
		req = signedIn(req, who)
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var rows []waste.WorkloadWaste
	if err := json.NewDecoder(rec.Body).Decode(&rows); err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, r := range rows {
		out = append(out, r.Ns)
	}
	slices.Sort(out)
	return out
}

func TestWasteWorkloadsOnlyShowsNamespacesTheSignedInUserCanListPodsIn(t *testing.T) {
	api := newSSARServer(t, map[string][]string{"alice": {"shop"}, "bob": {"*"}})
	h := wasteWorkloadsHandler(everyNamespace, podListAccessFor(managerFor(t, api.URL)))

	if got := wasteNamespaces(t, h, alice); !slices.Equal(got, []string{"shop"}) {
		t.Errorf("alice sees %v, want only shop", got)
	}
	if got := wasteNamespaces(t, h, bob); !slices.Equal(got, []string{"kube-system", "payments", "shop"}) {
		t.Errorf("bob sees %v, want every namespace", got)
	}
	if got := wasteNamespaces(t, h, &clusters.Identity{Name: "mallory"}); len(got) != 0 {
		t.Errorf("a user with no pod access sees %v", got)
	}
}

func TestWasteWorkloadsFailClosedWhenTheAccessCheckErrors(t *testing.T) {
	api := newSSARServer(t, map[string][]string{"alice": {"*"}})
	api.fail = true
	h := wasteWorkloadsHandler(everyNamespace, podListAccessFor(managerFor(t, api.URL)))
	if got := wasteNamespaces(t, h, alice); len(got) != 0 {
		t.Errorf("access check failed but alice sees %v", got)
	}
}

func TestWasteWorkloadsUnfilteredWithoutASignedInUser(t *testing.T) {
	api := newSSARServer(t, nil)
	h := wasteWorkloadsHandler(everyNamespace, podListAccessFor(managerFor(t, api.URL)))
	if got := wasteNamespaces(t, h, nil); len(got) != 3 {
		t.Errorf("desktop mode sees %v, want all three", got)
	}
	if api.count() != 0 {
		t.Errorf("desktop mode made %d access reviews, want none", api.count())
	}
}

// --- Prometheus ---

func countingProm(t *testing.T) (*httptest.Server, func() int) {
	t.Helper()
	var mu sync.Mutex
	n := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		n++
		mu.Unlock()
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	t.Cleanup(s.Close)
	return s, func() int { mu.Lock(); defer mu.Unlock(); return n }
}

func promQueryAs(t *testing.T, sm *SettingsManager, who *clusters.Identity) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=dev&query=up", nil)
	if who != nil {
		req = signedIn(req, who)
	}
	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, req)
	return rec.Code
}

func lockedSettings(t *testing.T, f *fakeAPIServer) *SettingsManager {
	t.Helper()
	sm := settingsForFake(t, f)
	sm.SharedLocked = SharedSettingsBlockReason(true, true)
	return sm
}

func TestOperatorPrometheusURLIsNotOpenToEveryOIDCUserByDefault(t *testing.T) {
	f := newFakeAPIServer(t)
	prom, hits := countingProm(t)
	sm := lockedSettings(t, f)
	sm.Operator.PrometheusURL = prom.URL

	for _, who := range []*clusters.Identity{alice, bob} {
		if code := promQueryAs(t, sm, who); code != http.StatusOK {
			t.Fatalf("%s: status %d", who.Name, code)
		}
	}
	if hits() != 0 {
		t.Fatalf("raw PromQL reached the engine-wide Prometheus URL %d times without the operator opting in", hits())
	}
	// It falls back to the service proxy, which the API server authorizes as the user.
	f.mu.Lock()
	users := slices.Clone(f.proxyUsers)
	f.mu.Unlock()
	if !slices.Equal(users, []string{"alice", "bob"}) {
		t.Fatalf("service-proxy queries impersonated %v, want alice then bob", users)
	}
}

func TestOperatorCanOpenThePrometheusURLToEveryOIDCUser(t *testing.T) {
	f := newFakeAPIServer(t)
	prom, hits := countingProm(t)
	sm := lockedSettings(t, f)
	sm.Operator.PrometheusURL = prom.URL
	sm.Operator.PrometheusAllUsers = true

	if code := promQueryAs(t, sm, alice); code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if hits() != 1 || len(f.proxied()) != 0 {
		t.Fatalf("opted-in URL hit %d times, proxy %v", hits(), f.proxied())
	}
}

func TestStoredPrometheusURLIsIgnoredOnceSettingsAreLocked(t *testing.T) {
	f := newFakeAPIServer(t)
	prom, hits := countingProm(t)
	sm := settingsForFake(t, f)
	setPromURL(t, sm, "dev", prom.URL) // saved before the upgrade, or by a user
	sm.SharedLocked = SharedSettingsBlockReason(true, true)
	sm.Operator.PrometheusAllUsers = true

	if code := promQueryAs(t, sm, alice); code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if hits() != 0 {
		t.Fatalf("a user-saved Prometheus URL was used %d times in a locked deployment", hits())
	}
	if u := sm.SamplerPrometheusURL("dev"); u != "" {
		t.Fatalf("the sampler would query a user-saved URL %q", u)
	}
}

func TestDesktopStillUsesTheSavedPrometheusURL(t *testing.T) {
	f := newFakeAPIServer(t)
	prom, hits := countingProm(t)
	sm := settingsForFake(t, f)
	setPromURL(t, sm, "dev", prom.URL)
	if code := promQueryAs(t, sm, nil); code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if hits() != 1 {
		t.Fatalf("desktop saved URL hit %d times, want 1", hits())
	}
	if u := sm.SamplerPrometheusURL("dev"); u != prom.URL {
		t.Fatalf("sampler URL %q, want %q", u, prom.URL)
	}
}

// --- Shared settings ---

func TestSharedSettingsBlockReason(t *testing.T) {
	if SharedSettingsBlockReason(false, false) != "" {
		t.Error("desktop must keep editable settings")
	}
	for _, c := range [][2]bool{{true, false}, {false, true}, {true, true}} {
		if SharedSettingsBlockReason(c[0], c[1]) == "" {
			t.Errorf("in-cluster=%v oidc=%v must lock shared settings", c[0], c[1])
		}
	}
}

func TestOneOIDCUserCannotChangeWhatRunsForAnother(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := lockedSettings(t, f)

	for _, body := range []string{
		`{"nodeShellImage":"evil.example/root:latest"}`,
		`{"debugImage":"evil.example/root:latest"}`,
		`{"prometheusUrl":"http://evil.example"}`,
		`{"prometheusUrls":{"dev":"http://evil.example"}}`,
		`{"extraKubeconfigs":["/tmp/kubeconfig"]}`,
	} {
		rec := httptest.NewRecorder()
		sm.HandleSave(rec, signedIn(httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(body)), alice))
		if rec.Code != http.StatusForbidden {
			t.Errorf("alice saved %s: status %d, want 403", body, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	sm.HandlePromTarget(rec, signedIn(httptest.NewRequest(http.MethodPost, "/api/prom/target", strings.NewReader(`{"cluster":"dev","target":"shop/fake-prom:80"}`)), alice))
	if rec.Code != http.StatusForbidden {
		t.Errorf("alice pinned a Prometheus target for everyone: status %d", rec.Code)
	}
	set, err := sm.Load()
	if err != nil {
		t.Fatal(err)
	}
	if set.NodeShellImage != "" || set.DebugImage != "" || set.PrometheusURL != "" || len(set.PrometheusTargets) != 0 {
		t.Fatalf("settings changed: %+v", set)
	}

	// Bob, an admin, then opens a node shell: it must not use anything Alice
	// could have stored.
	ns := &NodeShellManager{Settings: sm}
	if img := ns.image(); img != DefaultNodeShellImage {
		t.Errorf("bob's node shell would run %q", img)
	}
}

func TestLockedSettingsIgnoreStoredImagesAndUseTheOperatorsOnes(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	save(t, sm, `{"nodeShellImage":"evil.example/root:latest","debugImage":"evil.example/dbg:latest"}`)
	sm.SharedLocked = SharedSettingsBlockReason(true, true)
	ns := &NodeShellManager{Settings: sm}

	if img := ns.image(); img != DefaultNodeShellImage {
		t.Errorf("node shell image %q, want the default", img)
	}
	if img := sm.DebugImageDefault(); img != DefaultDebugImage {
		t.Errorf("debug image %q, want the default", img)
	}

	t.Setenv("KUBEBAY_NODE_SHELL_IMAGE", "mirror.corp/busybox:1")
	t.Setenv("KUBEBAY_DEBUG_IMAGE", "mirror.corp/debug:1")
	if img := ns.image(); img != "mirror.corp/busybox:1" {
		t.Errorf("node shell image %q, want the operator's", img)
	}
	if img := sm.DebugImageDefault(); img != "mirror.corp/debug:1" {
		t.Errorf("debug image %q, want the operator's", img)
	}

	rec := httptest.NewRecorder()
	sm.HandleGet(rec, signedIn(httptest.NewRequest(http.MethodGet, "/api/settings", nil), bob))
	var got map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got["sharedLocked"] == "" || got["sharedLocked"] == nil {
		t.Errorf("GET /api/settings does not say settings are locked: %v", got["sharedLocked"])
	}
	if got["nodeShellImage"] != "mirror.corp/busybox:1" || got["debugImage"] != "mirror.corp/debug:1" {
		t.Errorf("GET reports %v / %v, want the images in force", got["nodeShellImage"], got["debugImage"])
	}
}

func TestDesktopSettingsStayEditableAndInForce(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	save(t, sm, `{"nodeShellImage":"mirror.local/busybox:1","debugImage":"mirror.local/debug:1"}`)
	if img := (&NodeShellManager{Settings: sm}).image(); img != "mirror.local/busybox:1" {
		t.Errorf("node shell image %q", img)
	}
	if img := sm.DebugImageDefault(); img != "mirror.local/debug:1" {
		t.Errorf("debug image %q", img)
	}
	rec := httptest.NewRecorder()
	sm.HandlePromTarget(rec, httptest.NewRequest(http.MethodPost, "/api/prom/target", strings.NewReader(`{"cluster":"dev","target":"monitoring/prometheus-server:80"}`)))
	if rec.Code != http.StatusOK {
		t.Errorf("desktop pin: %d %s", rec.Code, rec.Body)
	}
	rec = httptest.NewRecorder()
	sm.HandleGet(rec, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	var got map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if v, ok := got["sharedLocked"]; ok && v != "" {
		t.Errorf("desktop reports locked settings: %v", v)
	}
}

var _ = context.Background
