package aiinvest

import "strings"

// ScrubEnv builds the child's environment from an allowlist. Claude Code
// needs PATH, HOME and the user's own CLAUDE_* / ANTHROPIC_* login settings
// and proxy/CA variables; nothing else is passed, so no kubeconfig path, cloud
// credential or Kubebay token reaches the model's process. The only Kubebay
// credential is the run token, written to the MCP config file, never to env.
func ScrubEnv(parent []string) []string {
	exact := map[string]bool{
		"PATH": true, "HOME": true, "USER": true, "LOGNAME": true, "LANG": true, "TERM": true, "TMPDIR": true,
		"HTTP_PROXY": true, "HTTPS_PROXY": true, "NO_PROXY": true, "ALL_PROXY": true,
		"http_proxy": true, "https_proxy": true, "no_proxy": true, "all_proxy": true,
		"SSL_CERT_FILE": true, "SSL_CERT_DIR": true, "NODE_EXTRA_CA_CERTS": true,
	}
	var out []string
	for _, kv := range parent {
		k, _, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		if exact[k] || strings.HasPrefix(k, "LC_") || strings.HasPrefix(k, "CLAUDE_") || strings.HasPrefix(k, "ANTHROPIC_") || strings.HasPrefix(k, "XDG_") {
			out = append(out, kv)
		}
	}
	return out
}
