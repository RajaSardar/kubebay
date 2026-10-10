package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/keychain"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
	"github.com/RajaSardar/kubebay/engine/internal/triage"
)

// TriageSettings is the user's incident-triage choice (backlog #13): off by
// default, and when on, only for the clusters listed. The API key is never
// here; it lives in the OS keychain or the environment.
type TriageSettings struct {
	Enabled  bool     `json:"enabled"`
	Clusters []string `json:"clusters,omitempty"`
	// BaseURL points at the Messages API, or an enterprise proxy speaking it.
	BaseURL string `json:"baseURL,omitempty"`
	Model   string `json:"model,omitempty"`
}

// TriageBlockReason: one engine serving several people has no single user
// whose consent and key a model call could carry.
func TriageBlockReason(inCluster, oidcEnabled bool) string {
	switch {
	case oidcEnabled:
		return "incident triage is off when OIDC is configured: one engine serves several people"
	case inCluster:
		return "incident triage is off in in-cluster mode"
	}
	return ""
}

const (
	triageKeyService = "kubebay-triage"
	triageKeyAccount = "api-key"
)

// The environment variables a key may come from, checked in this order.
var triageKeyEnv = []string{"KUBEBAY_TRIAGE_API_KEY", "ANTHROPIC_API_KEY"}

var (
	modelRe  = regexp.MustCompile(`^[A-Za-z0-9._:@/-]{1,128}$`)
	apiKeyRe = regexp.MustCompile(`^[A-Za-z0-9._~+/=:-]{16,512}$`)
)

// TriageAPI owns triage's switch, allowlist, key and preview. Slice 1 sends
// nothing: the preview is the exact request a later Send will make.
type TriageAPI struct {
	Settings *SettingsManager
	Evidence func(ctx context.Context, cluster, ns, pod string) (kubetools.Evidence, error)
	Keys     keychain.Store
	Getenv   func(string) string
	Audit    func(audit.Entry)
	// Disabled, when set, is why triage doesn't exist in this engine.
	Disabled string
}

func (a *TriageAPI) settings() TriageSettings {
	var t TriageSettings
	if set, err := a.Settings.Load(); err == nil && set.Triage != nil {
		t = *set.Triage
	}
	if t.BaseURL == "" {
		t.BaseURL = triage.DefaultBaseURL
	}
	if t.Model == "" {
		t.Model = triage.DefaultModel
	}
	if t.Clusters == nil {
		t.Clusters = []string{}
	}
	return t
}

// key finds the API key: the environment first, then the keychain.
func (a *TriageAPI) key() (key, source string, err error) {
	if a.Getenv != nil {
		for _, name := range triageKeyEnv {
			if v := strings.TrimSpace(a.Getenv(name)); v != "" {
				return v, "env:" + name, nil
			}
		}
	}
	if a.Keys == nil {
		return "", "", keychain.ErrUnsupported
	}
	k, err := a.Keys.Get(triageKeyService, triageKeyAccount)
	if err != nil {
		return "", "", err
	}
	return k, "keychain", nil
}

type triageKeyStatus struct {
	// Source is "env:NAME", "keychain" or "" (no key).
	Source string `json:"source"`
	// Store names the OS keychain, or "" when there's none to save to.
	Store string `json:"store"`
	Error string `json:"error,omitempty"`
}

type triageStatus struct {
	TriageSettings
	Key      triageKeyStatus `json:"key"`
	Disabled string          `json:"disabled,omitempty"`
}

func (a *TriageAPI) status() triageStatus {
	st := triageStatus{TriageSettings: a.settings(), Disabled: a.Disabled}
	if a.Keys != nil {
		st.Key.Store = a.Keys.Name()
	}
	if a.Disabled != "" {
		return st
	}
	_, src, err := a.key()
	st.Key.Source = src
	if err != nil && !errors.Is(err, keychain.ErrNotFound) && !errors.Is(err, keychain.ErrUnsupported) {
		st.Key.Error = err.Error()
	}
	return st
}

func (a *TriageAPI) HandleGet(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, a.status())
}

// normalizeBaseURL accepts https anywhere and http only on loopback (a
// local proxy), so a key never crosses the network in the clear.
func normalizeBaseURL(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("endpoint %q isn't a URL", raw)
	}
	switch u.Scheme {
	case "https":
	case "http":
		host := u.Hostname()
		if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return "", fmt.Errorf("endpoint %q: use https, or http only for a proxy on this machine", raw)
		}
	default:
		return "", fmt.Errorf("endpoint %q: use https", raw)
	}
	if raw == triage.DefaultBaseURL {
		return "", nil
	}
	return raw, nil
}

func (a *TriageAPI) refuse(w http.ResponseWriter) bool {
	if a.Disabled != "" {
		http.Error(w, a.Disabled, http.StatusForbidden)
		return true
	}
	return false
}

// HandleSave sets the switch, allowlist, endpoint and model.
func (a *TriageAPI) HandleSave(w http.ResponseWriter, r *http.Request) {
	if a.refuse(w) {
		return
	}
	var body TriageSettings
	if err := decodeBody(r, &body); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	for _, c := range body.Clusters {
		if strings.TrimSpace(c) == "" {
			http.Error(w, "empty cluster ID", http.StatusBadRequest)
			return
		}
	}
	base, err := normalizeBaseURL(body.BaseURL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	body.BaseURL = base
	body.Model = strings.TrimSpace(body.Model)
	if body.Model == triage.DefaultModel {
		body.Model = ""
	}
	if body.Model != "" && !modelRe.MatchString(body.Model) {
		http.Error(w, fmt.Sprintf("model %q: letters, digits and . _ : @ / - only", body.Model), http.StatusBadRequest)
		return
	}
	if err := a.Settings.saveTriage(&body); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, a.status())
}

// HandlePutKey saves the API key in the OS keychain.
func (a *TriageAPI) HandlePutKey(w http.ResponseWriter, r *http.Request) {
	if a.refuse(w) {
		return
	}
	var body struct {
		Key string `json:"key"`
	}
	if err := decodeBody(r, &body); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	k := strings.TrimSpace(body.Key)
	if !apiKeyRe.MatchString(k) {
		http.Error(w, "that doesn't look like an API key", http.StatusBadRequest)
		return
	}
	if a.Keys == nil || a.Keys.Name() == "" {
		http.Error(w, "there's no keychain to save to on this system: set KUBEBAY_TRIAGE_API_KEY in Kubebay's environment instead", http.StatusNotImplemented)
		return
	}
	if err := a.Keys.Set(triageKeyService, triageKeyAccount, k); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, a.status())
}

// HandleDeleteKey removes the key from the keychain (not the environment).
func (a *TriageAPI) HandleDeleteKey(w http.ResponseWriter, _ *http.Request) {
	if a.Keys != nil {
		if err := a.Keys.Delete(triageKeyService, triageKeyAccount); err != nil && !errors.Is(err, keychain.ErrUnsupported) {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	writeJSON(w, a.status())
}

// HandlePreview assembles one pod's evidence and returns the exact request
// a Send would make, so the user reviews it before anything leaves.
func (a *TriageAPI) HandlePreview(w http.ResponseWriter, r *http.Request) {
	if a.refuse(w) {
		return
	}
	var body struct {
		Cluster   string `json:"cluster"`
		Namespace string `json:"namespace"`
		Pod       string `json:"pod"`
	}
	if err := decodeBody(r, &body); err != nil || body.Cluster == "" || body.Namespace == "" || body.Pod == "" {
		http.Error(w, "cluster, namespace and pod are required", http.StatusBadRequest)
		return
	}
	set := a.settings()
	if !set.Enabled {
		http.Error(w, "incident triage is off: turn it on in Settings", http.StatusForbidden)
		return
	}
	allowed := false
	for _, c := range set.Clusters {
		allowed = allowed || c == body.Cluster
	}
	if !allowed {
		http.Error(w, fmt.Sprintf("incident triage isn't allowed for cluster %q: add it in Settings", body.Cluster), http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	ev, err := a.Evidence(ctx, body.Cluster, body.Namespace, body.Pod)
	entry := audit.Entry{Action: "triage:preview", Cluster: body.Cluster, Namespace: body.Namespace, Resource: body.Pod, UserAgent: r.Header.Get("User-Agent"), Source: "triage"}
	if err != nil {
		entry.Detail = "error=" + err.Error()
		a.record(entry)
		http.Error(w, "couldn't gather the evidence: "+err.Error(), http.StatusBadGateway)
		return
	}
	req := triage.BuildRequest(set.Model, ev)
	entry.Detail = fmt.Sprintf("sections=%d masked=%d approxTokens=%d", len(ev.Sections), ev.Masked, triage.ApproxTokens(req))
	a.record(entry)
	_, src, _ := a.key()
	writeJSON(w, map[string]any{
		"endpoint":     set.BaseURL + "/v1/messages",
		"request":      req,
		"evidence":     ev,
		"approxTokens": triage.ApproxTokens(req),
		"keySource":    src,
	})
}

func (a *TriageAPI) record(e audit.Entry) {
	if a.Audit != nil {
		a.Audit(e)
	}
}
