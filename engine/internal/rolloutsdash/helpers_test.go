package rolloutsdash

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeExe(t *testing.T, dir, name string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestFindPrefersPathThenCandidates(t *testing.T) {
	a, b := t.TempDir(), t.TempDir()
	pa := writeExe(t, a, PluginName)
	pb := writeExe(t, b, PluginName)
	if got := Find(a, []string{pb}); got != pa {
		t.Fatalf("PATH first: got %q want %q", got, pa)
	}
	if got := Find(t.TempDir(), []string{pb}); got != pb {
		t.Fatalf("candidate: got %q want %q", got, pb)
	}
	if got := Find("", nil); got != "" {
		t.Fatalf("nothing installed: %q", got)
	}
}

func TestFindIgnoresRelativePathEntriesAndNonExecutables(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	writeExe(t, dir, PluginName)
	if got := Find(".:", nil); got != "" {
		t.Fatalf("relative PATH entry must be ignored, got %q", got)
	}
	plain := filepath.Join(t.TempDir(), PluginName)
	_ = os.WriteFile(plain, []byte("x"), 0o644)
	if got := Find("", []string{plain}); got != "" {
		t.Fatalf("non-executable accepted: %q", got)
	}
}

func TestCommonPathsCoverBrewKrewAndGo(t *testing.T) {
	got := strings.Join(CommonPaths("/home/u"), " ")
	for _, want := range []string{"/opt/homebrew/bin/" + PluginName, "/usr/local/bin/" + PluginName, "/home/u/.krew/bin/" + PluginName, "/home/u/go/bin/" + PluginName} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s in %s", want, got)
		}
	}
}

func TestInstallHelpIsTextOnly(t *testing.T) {
	h := InstallHelp()
	joined := strings.Join(h.Commands, "\n")
	if !strings.Contains(joined, "brew install argoproj/tap/kubectl-argo-rollouts") || !strings.Contains(joined, "kubectl krew install argo-rollouts") {
		t.Fatalf("commands: %v", h.Commands)
	}
	if !strings.HasPrefix(h.ReleasesURL, "https://github.com/argoproj/argo-rollouts/releases") {
		t.Fatalf("releases: %s", h.ReleasesURL)
	}
}

func TestEnvIsScrubbedToWhatTheToolNeeds(t *testing.T) {
	parent := []string{
		"HOME=/home/u", "PATH=/usr/bin:/bin", "LANG=en_US.UTF-8", "KUBECONFIG=/other:/files",
		"KUBEBAY_TOKEN=secret", "KUBEBAY_MCP=1", "AWS_SECRET_ACCESS_KEY=x", "ANTHROPIC_API_KEY=y", "GITHUB_TOKEN=z",
	}
	env := BuildEnv(parent, "/home/u/.kube/work", "/opt/homebrew/bin")
	m := map[string]string{}
	for _, kv := range env {
		k, v, _ := strings.Cut(kv, "=")
		m[k] = v
	}
	if m["KUBECONFIG"] != "/home/u/.kube/work" {
		t.Fatalf("KUBECONFIG must be only the dedicated file: %q", m["KUBECONFIG"])
	}
	if m["HOME"] != "/home/u" || m["LANG"] != "en_US.UTF-8" {
		t.Fatalf("env: %v", m)
	}
	if !strings.HasPrefix(m["PATH"], "/opt/homebrew/bin"+string(os.PathListSeparator)) || !strings.Contains(m["PATH"], "/usr/bin") {
		t.Fatalf("PATH: %q", m["PATH"])
	}
	for k := range m {
		if strings.HasPrefix(k, "KUBEBAY_") || k == "AWS_SECRET_ACCESS_KEY" || k == "ANTHROPIC_API_KEY" || k == "GITHUB_TOKEN" {
			t.Errorf("leaked %s", k)
		}
	}
}

func TestArgvWithOneNamespace(t *testing.T) {
	got, err := BuildArgv(ArgvOptions{Kubeconfig: "/k/config", Context: "kind-dev", Namespaces: []string{"shop"}, Port: 4321, RootPath: "/api/rollouts-dashboard/tok/"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"dashboard", "--kubeconfig", "/k/config", "--context", "kind-dev", "--namespace", "shop", "--port", "4321", "--root-path", "/api/rollouts-dashboard/tok"}
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestArgvAllNamespacesWhenNotExactlyOne(t *testing.T) {
	for _, ns := range [][]string{nil, {}, {"a", "b"}} {
		got, err := BuildArgv(ArgvOptions{Kubeconfig: "/k", Context: "c", Namespaces: ns, Port: 1, RootPath: "/p"})
		if err != nil {
			t.Fatal(err)
		}
		for _, a := range got {
			if a == "--namespace" {
				t.Errorf("namespaces %v must not add --namespace: %v", ns, got)
			}
		}
	}
}

func TestArgvRejectsHostileValues(t *testing.T) {
	bad := []ArgvOptions{
		{Kubeconfig: "/k", Context: "--kubeconfig=/etc/passwd", Port: 1, RootPath: "/p"},
		{Kubeconfig: "/k", Context: "c", Namespaces: []string{"-A"}, Port: 1, RootPath: "/p"},
		{Kubeconfig: "/k", Context: "c", Namespaces: []string{"Bad_NS"}, Port: 1, RootPath: "/p"},
		{Kubeconfig: "/k", Context: "c", Namespaces: []string{"a;rm"}, Port: 1, RootPath: "/p"},
		{Kubeconfig: "-x", Context: "c", Port: 1, RootPath: "/p"},
		{Kubeconfig: "/k", Context: "c", Port: 0, RootPath: "/p"},
		{Kubeconfig: "/k", Context: "c", Port: 1, RootPath: "no-slash"},
		{Kubeconfig: "/k", Context: "", Port: 1, RootPath: "/p"},
	}
	for i, o := range bad {
		if _, err := BuildArgv(o); err == nil {
			t.Errorf("case %d accepted: %+v", i, o)
		}
	}
	// Real context names are free-form (EKS ARNs, gke_proj_zone_name).
	for _, ctx := range []string{"arn:aws:eks:us-east-1:123:cluster/prod", "gke_p_z_c", "kind-dev", "user@host"} {
		if _, err := BuildArgv(ArgvOptions{Kubeconfig: "/k", Context: ctx, Port: 1, RootPath: "/p"}); err != nil {
			t.Errorf("context %q refused: %v", ctx, err)
		}
	}
}
