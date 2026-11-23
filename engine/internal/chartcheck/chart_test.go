// Package chartcheck renders the Helm chart with the real `helm template` and
// checks the security posture an operator gets: the engine's cluster-wide
// impersonation power only when OIDC needs it, only the verbs and resources it
// uses, and a pod that runs with no more than it needs.
package chartcheck

import (
	"bytes"
	"io"
	"os/exec"
	"path/filepath"
	"sort"
	"testing"

	"k8s.io/apimachinery/pkg/util/yaml"
)

type doc = map[string]any

func render(t *testing.T, sets ...string) []doc {
	t.Helper()
	if _, err := exec.LookPath("helm"); err != nil {
		t.Skip("helm is not installed")
	}
	chart, err := filepath.Abs("../../../charts/kubebay")
	if err != nil {
		t.Fatal(err)
	}
	args := []string{"template", "kubebay", chart, "--namespace", "kb"}
	for _, s := range sets {
		args = append(args, "--set", s)
	}
	out, err := exec.Command("helm", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("helm template: %v\n%s", err, out)
	}
	dec := yaml.NewYAMLOrJSONDecoder(bytes.NewReader(out), 4096)
	var docs []doc
	for {
		var d doc
		if err := dec.Decode(&d); err == io.EOF {
			break
		} else if err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(d) > 0 {
			docs = append(docs, d)
		}
	}
	return docs
}

func ofKind(docs []doc, kind string) []doc {
	var out []doc
	for _, d := range docs {
		if d["kind"] == kind {
			out = append(out, d)
		}
	}
	return out
}

func dig(v any, path ...string) any {
	for _, p := range path {
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		v = m[p]
	}
	return v
}

var oidc = []string{"oidc.issuerUrl=https://idp.example.com", "oidc.clientId=kubebay", "oidc.clientSecret=s3cret", "oidc.redirectUrl=https://kubebay.example.com/api/auth/callback"}

func TestWithoutOIDCTheEngineCannotImpersonateAnyone(t *testing.T) {
	docs := render(t)
	for _, k := range []string{"ClusterRole", "ClusterRoleBinding"} {
		if got := ofKind(docs, k); len(got) != 0 {
			t.Errorf("no OIDC means nobody to impersonate, but the chart renders %d %s", len(got), k)
		}
	}
}

func TestOIDCGrantsOnlyUserAndGroupImpersonation(t *testing.T) {
	roles := ofKind(render(t, oidc...), "ClusterRole")
	if len(roles) != 1 {
		t.Fatalf("want one ClusterRole with OIDC on, got %d", len(roles))
	}
	var resources []string
	for _, r := range dig(roles[0], "rules").([]any) {
		rule := r.(map[string]any)
		verbs := rule["verbs"].([]any)
		if len(verbs) != 1 || verbs[0] != "impersonate" {
			t.Errorf("rule grants %v, want only impersonate", verbs)
		}
		for _, res := range rule["resources"].([]any) {
			resources = append(resources, res.(string))
		}
	}
	sort.Strings(resources)
	if len(resources) != 2 || resources[0] != "groups" || resources[1] != "users" {
		t.Errorf("impersonation covers %v; the engine impersonates a user name and groups, never a service account", resources)
	}
}

func TestImpersonationCanBeNarrowedToNamedGroups(t *testing.T) {
	roles := ofKind(render(t, append(oidc, "impersonation.groups={team-a,team-b}")...), "ClusterRole")
	if len(roles) != 1 {
		t.Fatalf("want one ClusterRole, got %d", len(roles))
	}
	for _, r := range dig(roles[0], "rules").([]any) {
		rule := r.(map[string]any)
		if rule["resources"].([]any)[0] != "groups" {
			continue
		}
		names, _ := rule["resourceNames"].([]any)
		if len(names) != 2 || names[0] != "team-a" || names[1] != "team-b" {
			t.Errorf("groups rule resourceNames = %v, want [team-a team-b]", names)
		}
		return
	}
	t.Error("no rule for groups")
}

func TestThePodRunsWithNoMoreThanItNeeds(t *testing.T) {
	deps := ofKind(render(t), "Deployment")
	if len(deps) != 1 {
		t.Fatalf("want one Deployment, got %d", len(deps))
	}
	spec := dig(deps[0], "spec", "template", "spec").(map[string]any)

	if dig(spec, "securityContext", "runAsNonRoot") != true {
		t.Error("pod securityContext.runAsNonRoot is not true")
	}
	if dig(spec, "securityContext", "seccompProfile", "type") != "RuntimeDefault" {
		t.Error("pod seccompProfile is not RuntimeDefault")
	}
	c := spec["containers"].([]any)[0].(map[string]any)
	if dig(c, "securityContext", "allowPrivilegeEscalation") != false {
		t.Error("container allowPrivilegeEscalation is not false")
	}
	if dig(c, "securityContext", "readOnlyRootFilesystem") != true {
		t.Error("container readOnlyRootFilesystem is not true")
	}
	drop, _ := dig(c, "securityContext", "capabilities", "drop").([]any)
	if len(drop) != 1 || drop[0] != "ALL" {
		t.Errorf("container capabilities.drop = %v, want [ALL]", drop)
	}
	// With a read-only root the engine still needs somewhere to write its
	// settings and audit log.
	mounted := false
	for _, m := range c["volumeMounts"].([]any) {
		if m.(map[string]any)["mountPath"] == "/tmp" {
			mounted = true
		}
	}
	if !mounted {
		t.Error("no writable /tmp mounted for the read-only root filesystem")
	}
}

func engineEnv(t *testing.T, sets ...string) map[string]string {
	t.Helper()
	deps := ofKind(render(t, sets...), "Deployment")
	if len(deps) != 1 {
		t.Fatalf("want one Deployment, got %d", len(deps))
	}
	c := dig(deps[0], "spec", "template", "spec").(map[string]any)["containers"].([]any)[0].(map[string]any)
	out := map[string]string{}
	for _, e := range c["env"].([]any) {
		m := e.(map[string]any)
		if v, ok := m["value"].(string); ok {
			out[m["name"].(string)] = v
		}
	}
	return out
}

// On a shared engine the settings API is read-only, so whatever runs or is
// queried on every user's behalf is set here, by the operator.
func TestOperatorSetsTheSharedSettingsThroughValues(t *testing.T) {
	env := engineEnv(t)
	for _, k := range []string{"KUBEBAY_NODE_SHELL_IMAGE", "KUBEBAY_DEBUG_IMAGE", "KUBEBAY_PROMETHEUS_URL", "KUBEBAY_PROMETHEUS_ALL_USERS"} {
		if _, ok := env[k]; ok {
			t.Errorf("%s is set with no value given", k)
		}
	}
	env = engineEnv(t,
		"nodeShellImage=mirror.corp/busybox:1",
		"debugImage=mirror.corp/debug:1",
		"prometheus.url=http://prometheus.monitoring:9090",
		"prometheus.allUsers=true",
	)
	want := map[string]string{
		"KUBEBAY_NODE_SHELL_IMAGE":     "mirror.corp/busybox:1",
		"KUBEBAY_DEBUG_IMAGE":          "mirror.corp/debug:1",
		"KUBEBAY_PROMETHEUS_URL":       "http://prometheus.monitoring:9090",
		"KUBEBAY_PROMETHEUS_ALL_USERS": "true",
	}
	for k, v := range want {
		if env[k] != v {
			t.Errorf("%s = %q, want %q", k, env[k], v)
		}
	}
}

// The Helm repository list is read-only in the app on a shared engine, so the
// operator lists the repositories every user installs from here.
func TestOperatorSetsTheHelmRepositoriesThroughValues(t *testing.T) {
	if _, ok := engineEnv(t)["KUBEBAY_HELM_REPOS"]; ok {
		t.Error("KUBEBAY_HELM_REPOS is set with no repositories given")
	}
	env := engineEnv(t,
		"helmRepos[0].name=bitnami",
		"helmRepos[0].url=https://charts.example.com/bitnami",
		"helmRepos[1].name=corp",
		"helmRepos[1].url=https://charts.corp.example/stable",
	)
	if got, want := env["KUBEBAY_HELM_REPOS"], "bitnami=https://charts.example.com/bitnami,corp=https://charts.corp.example/stable"; got != want {
		t.Errorf("KUBEBAY_HELM_REPOS = %q, want %q", got, want)
	}
}
