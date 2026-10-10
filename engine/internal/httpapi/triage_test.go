package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/keychain"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
)

type fakeKeys struct {
	name   string
	stored map[string]string
}

func (f *fakeKeys) Name() string { return f.name }
func (f *fakeKeys) Get(svc, acct string) (string, error) {
	if f.name == "" {
		return "", keychain.ErrUnsupported
	}
	v, ok := f.stored[svc+"/"+acct]
	if !ok {
		return "", keychain.ErrNotFound
	}
	return v, nil
}
func (f *fakeKeys) Set(svc, acct, secret string) error {
	if f.name == "" {
		return keychain.ErrUnsupported
	}
	f.stored[svc+"/"+acct] = secret
	return nil
}
func (f *fakeKeys) Delete(svc, acct string) error {
	delete(f.stored, svc+"/"+acct)
	return nil
}

type triageFixture struct {
	api       *TriageAPI
	sm        *SettingsManager
	keys      *fakeKeys
	env       map[string]string
	entries   []audit.Entry
	evidenced []string
}

func newTriageFixture(t *testing.T) *triageFixture {
	t.Helper()
	f := &triageFixture{sm: settingsWithManager(t), keys: &fakeKeys{name: "macOS Keychain", stored: map[string]string{}}, env: map[string]string{}}
	f.api = &TriageAPI{
		Settings: f.sm,
		Keys:     f.keys,
		Getenv:   func(k string) string { return f.env[k] },
		Audit:    func(e audit.Entry) { f.entries = append(f.entries, e) },
		Evidence: func(_ context.Context, cluster, ns, pod string) (kubetools.Evidence, error) {
			f.evidenced = append(f.evidenced, cluster+"/"+ns+"/"+pod)
			return kubetools.Evidence{Cluster: cluster, Namespace: ns, Pod: pod, Masked: 2, Sections: []kubetools.EvidenceSection{
				{ID: "E1", Title: "Pod " + ns + "/" + pod, Text: "phase: Running"},
				{ID: "E2", Title: "Logs of api (previous run, exited 2: Error)", Text: "panic: nil map"},
			}}, nil
		},
	}
	return f
}

func (f *triageFixture) do(t *testing.T, h http.HandlerFunc, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(method, "/api/triage", strings.NewReader(body)))
	return rec
}

type triageStatusBody struct {
	Enabled  bool     `json:"enabled"`
	Clusters []string `json:"clusters"`
	BaseURL  string   `json:"baseURL"`
	Model    string   `json:"model"`
	Disabled string   `json:"disabled"`
	Key      struct {
		Source string `json:"source"`
		Store  string `json:"store"`
	} `json:"key"`
}

func (f *triageFixture) status(t *testing.T) triageStatusBody {
	t.Helper()
	var st triageStatusBody
	rec := f.do(t, f.api.HandleGet, http.MethodGet, "")
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	return st
}

func TestTriageIsOffUntilTurnedOn(t *testing.T) {
	f := newTriageFixture(t)
	st := f.status(t)
	if st.Enabled || len(st.Clusters) != 0 || st.Model != "claude-opus-5-5" || st.BaseURL != "https://api.anthropic.com" || st.Key.Source != "" || st.Key.Store != "macOS Keychain" {
		t.Errorf("status = %+v", st)
	}
}

func TestPreviewNeedsTheSwitchAndAnAllowedCluster(t *testing.T) {
	f := newTriageFixture(t)
	preview := `{"cluster":"kind-dev","namespace":"shop","pod":"api-7d9-x"}`
	if rec := f.do(t, f.api.HandlePreview, http.MethodPost, preview); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "Settings") {
		t.Errorf("off: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(t, f.api.HandleSave, http.MethodPost, `{"enabled":true,"clusters":["kind-dev"]}`); rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(t, f.api.HandlePreview, http.MethodPost, `{"cluster":"prod","namespace":"shop","pod":"api-7d9-x"}`); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "prod") {
		t.Errorf("cluster not allowed: %d %s", rec.Code, rec.Body)
	}
	if len(f.evidenced) != 0 {
		t.Errorf("nothing is read before both gates pass: %v", f.evidenced)
	}
}

func TestPreviewIsTheExactRequestAndIsAudited(t *testing.T) {
	f := newTriageFixture(t)
	f.do(t, f.api.HandleSave, http.MethodPost, `{"enabled":true,"clusters":["kind-dev"]}`)
	f.keys.stored["kubebay-triage/api-key"] = "sk-ant-secret-value-1234567890"
	rec := f.do(t, f.api.HandlePreview, http.MethodPost, `{"cluster":"kind-dev","namespace":"shop","pod":"api-7d9-x"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "sk-ant-secret") {
		t.Fatal("the key is never in a response")
	}
	var got struct {
		Endpoint     string `json:"endpoint"`
		ApproxTokens int    `json:"approxTokens"`
		Request      struct {
			Model    string `json:"model"`
			System   string `json:"system"`
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		} `json:"request"`
		Evidence struct {
			Masked   int `json:"masked"`
			Sections []struct {
				ID string `json:"id"`
			} `json:"sections"`
		} `json:"evidence"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.Endpoint != "https://api.anthropic.com/v1/messages" || got.Request.Model != "claude-opus-5-5" || got.ApproxTokens == 0 {
		t.Errorf("preview = %s", rec.Body)
	}
	if len(got.Request.Messages) != 1 || !strings.Contains(got.Request.Messages[0].Content, "[E2] Logs of api (previous run") || got.Evidence.Masked != 2 || len(got.Evidence.Sections) != 2 {
		t.Errorf("preview = %s", rec.Body)
	}
	if len(f.entries) != 1 || f.entries[0].Action != "triage:preview" || f.entries[0].Source != "triage" || f.entries[0].Resource != "api-7d9-x" || f.entries[0].Cluster != "kind-dev" {
		t.Errorf("audit = %+v", f.entries)
	}
}

func TestTriageSaveValidatesTheEndpointAndModel(t *testing.T) {
	f := newTriageFixture(t)
	for body, want := range map[string]int{
		`{"enabled":true,"clusters":["kind-dev"],"baseURL":"http://llm.example.com"}`:     http.StatusBadRequest,
		`{"enabled":true,"clusters":["kind-dev"],"baseURL":"ftp://llm.example.com"}`:      http.StatusBadRequest,
		`{"enabled":true,"clusters":["kind-dev"],"model":"claude opus"}`:                  http.StatusBadRequest,
		`{"enabled":true,"clusters":[""]}`:                                                http.StatusBadRequest,
		`{"enabled":true,"clusters":["kind-dev"],"baseURL":"http://127.0.0.1:4000/"}`:     http.StatusOK,
		`{"enabled":true,"clusters":["kind-dev"],"baseURL":"https://llm.corp.example/"}`:  http.StatusOK,
		`{"enabled":true,"clusters":["kind-dev"],"model":"anthropic.claude-v2:1@latest"}`: http.StatusOK,
	} {
		if rec := f.do(t, f.api.HandleSave, http.MethodPost, body); rec.Code != want {
			t.Errorf("%s: %d %s", body, rec.Code, rec.Body)
		}
	}
	f.do(t, f.api.HandleSave, http.MethodPost, `{"enabled":true,"clusters":["kind-dev"],"baseURL":"https://llm.corp.example/"}`)
	if st := f.status(t); st.BaseURL != "https://llm.corp.example" {
		t.Errorf("trailing slash trimmed: %q", st.BaseURL)
	}
}

func TestTheKeyGoesToTheKeychainNeverToSettings(t *testing.T) {
	f := newTriageFixture(t)
	rec := f.do(t, f.api.HandlePutKey, http.MethodPut, `{"key":"sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if f.keys.stored["kubebay-triage/api-key"] != "sk-ant-api03-abcdefghijklmnopqrstuvwxyz" {
		t.Errorf("stored = %v", f.keys.stored)
	}
	home, _ := os.UserHomeDir()
	b, _ := os.ReadFile(filepath.Join(home, ".kubebay", "settings.json"))
	if strings.Contains(string(b), "sk-ant") || strings.Contains(rec.Body.String(), "sk-ant") {
		t.Error("the key must not be in settings.json or a response")
	}
	if st := f.status(t); st.Key.Source != "keychain" {
		t.Errorf("source = %q", st.Key.Source)
	}
	if rec := f.do(t, f.api.HandleDeleteKey, http.MethodDelete, ""); rec.Code != http.StatusOK || len(f.keys.stored) != 0 {
		t.Errorf("delete: %d %v", rec.Code, f.keys.stored)
	}
	if rec := f.do(t, f.api.HandlePutKey, http.MethodPut, `{"key":"has space in it"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("bad key: %d", rec.Code)
	}
}

func TestAnEnvironmentKeyWinsAndIsNamed(t *testing.T) {
	f := newTriageFixture(t)
	f.keys.stored["kubebay-triage/api-key"] = "from-keychain-0123456789"
	f.env["ANTHROPIC_API_KEY"] = "from-env-0123456789"
	if st := f.status(t); st.Key.Source != "env:ANTHROPIC_API_KEY" {
		t.Errorf("source = %q", st.Key.Source)
	}
	f.env["KUBEBAY_TRIAGE_API_KEY"] = "kubebay-env-0123456789"
	if st := f.status(t); st.Key.Source != "env:KUBEBAY_TRIAGE_API_KEY" {
		t.Errorf("source = %q", st.Key.Source)
	}
	if k, src, err := f.api.key(); err != nil || k != "kubebay-env-0123456789" || src != "env:KUBEBAY_TRIAGE_API_KEY" {
		t.Errorf("key() = %q %q %v", k, src, err)
	}
}

func TestWithoutAKeychainTheUserIsToldToUseTheEnvironment(t *testing.T) {
	f := newTriageFixture(t)
	f.keys.name = ""
	rec := f.do(t, f.api.HandlePutKey, http.MethodPut, `{"key":"sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}`)
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "KUBEBAY_TRIAGE_API_KEY") {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
	if st := f.status(t); st.Key.Store != "" {
		t.Errorf("store = %q", st.Key.Store)
	}
}

func TestTriageSurvivesTheSettingsPageSaving(t *testing.T) {
	f := newTriageFixture(t)
	f.do(t, f.api.HandleSave, http.MethodPost, `{"enabled":true,"clusters":["kind-dev"],"model":"claude-sonnet-5-5"}`)
	save(t, f.sm, `{"prometheusUrl":"http://127.0.0.1:9090"}`)
	if st := f.status(t); !st.Enabled || st.Model != "claude-sonnet-5-5" || len(st.Clusters) != 1 {
		t.Errorf("settings save dropped triage: %+v", st)
	}
}

func TestTriageIsUnavailableInSharedEngines(t *testing.T) {
	f := newTriageFixture(t)
	f.api.Disabled = TriageBlockReason(false, true)
	if st := f.status(t); st.Disabled == "" {
		t.Error("status should say why")
	}
	for _, h := range []http.HandlerFunc{f.api.HandleSave, f.api.HandlePreview, f.api.HandlePutKey} {
		if rec := f.do(t, h, http.MethodPost, `{"enabled":true,"clusters":["kind-dev"]}`); rec.Code != http.StatusForbidden {
			t.Errorf("%d %s", rec.Code, rec.Body)
		}
	}
	if TriageBlockReason(false, false) != "" || TriageBlockReason(true, false) == "" {
		t.Error("block reasons")
	}
}

func TestPreviewReportsAMissingPod(t *testing.T) {
	f := newTriageFixture(t)
	f.do(t, f.api.HandleSave, http.MethodPost, `{"enabled":true,"clusters":["kind-dev"]}`)
	f.api.Evidence = func(context.Context, string, string, string) (kubetools.Evidence, error) {
		return kubetools.Evidence{}, errors.New(`pods "nope" not found`)
	}
	if rec := f.do(t, f.api.HandlePreview, http.MethodPost, `{"cluster":"kind-dev","namespace":"shop","pod":"nope"}`); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "not found") {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
}

func TestTriageRoutesNeedTheUIToken(t *testing.T) {
	f := newTriageFixture(t)
	srv := httptest.NewServer(Router(Deps{Clusters: f.sm.mgr, Triage: f.api}, "ui-token"))
	t.Cleanup(srv.Close)
	for _, tc := range []struct {
		method, path, token string
		want                int
	}{
		{http.MethodGet, "/api/triage", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/triage/preview", "", http.StatusUnauthorized},
		{http.MethodPut, "/api/triage/key", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/triage", "ui-token", http.StatusOK},
	} {
		req, _ := http.NewRequest(tc.method, srv.URL+tc.path, strings.NewReader(`{}`))
		if tc.token != "" {
			req.Header.Set("X-Kubebay-Token", tc.token)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Errorf("%s %s token=%q: %d, want %d", tc.method, tc.path, tc.token, res.StatusCode, tc.want)
		}
	}
}
