package aiinvest

import (
	"strings"
	"testing"
)

func TestScrubEnvAllowlist(t *testing.T) {
	parent := []string{
		"PATH=/usr/bin", "HOME=/Users/x", "LANG=en_US.UTF-8", "HTTPS_PROXY=http://p:1",
		"CLAUDE_CODE_OAUTH_TOKEN=users-own", "ANTHROPIC_API_KEY=users-own",
		"KUBECONFIG=/Users/x/.kube/config", "KUBEBAY_TOKEN=t", "KUBEBAY_MCP_CONNECTION=/x",
		"AWS_SECRET_ACCESS_KEY=s", "AWS_PROFILE=prod", "GITHUB_TOKEN=g", "GOOGLE_APPLICATION_CREDENTIALS=/g",
		"AZURE_CLIENT_SECRET=a", "MY_SECRET=1", "DB_PASSWORD=1", "SOME_KEY=1", "SSH_AUTH_SOCK=/s", "EDITOR=vim",
	}
	got := strings.Join(ScrubEnv(parent), "\n")
	for _, keep := range []string{"PATH=", "HOME=", "LANG=", "HTTPS_PROXY=", "CLAUDE_CODE_OAUTH_TOKEN=", "ANTHROPIC_API_KEY="} {
		if !strings.Contains(got, keep) {
			t.Errorf("%s dropped", keep)
		}
	}
	for _, drop := range []string{"KUBECONFIG", "KUBEBAY_", "AWS_", "GITHUB_TOKEN", "GOOGLE_", "AZURE_", "MY_SECRET", "DB_PASSWORD", "SOME_KEY", "SSH_AUTH_SOCK", "EDITOR"} {
		if strings.Contains(got, drop) {
			t.Errorf("%s leaked into the child environment", drop)
		}
	}
}
