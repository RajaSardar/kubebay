// Package redact masks credentials in free text: log lines and event
// messages that Kubebay hands to a model (MCP get_logs, incident triage).
// Structured values (env, Secrets, ConfigMaps) are kept out by the callers;
// this pass catches what leaks into text anyway. It is pattern-based, so it
// lowers the risk rather than removing it.
package redact

import (
	"regexp"
	"strings"
)

// Mask replaces each value found.
const Mask = "<redacted>"

type rule struct {
	re *regexp.Regexp
	// keep returns the replacement for one match; nil masks the whole match.
	keep func(sub []string) string
}

var rules = []rule{
	// PEM private keys, whole block.
	{re: regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`)},
	// Credentials in URLs: keep the scheme, user and host.
	{re: regexp.MustCompile(`([A-Za-z][A-Za-z0-9+.-]*://[^/\s:@]+:)([^@\s/]+)@`), keep: func(s []string) string { return s[1] + Mask + "@" }},
	// Provider token formats.
	{re: regexp.MustCompile(`\bsk-ant-[A-Za-z0-9_-]{20,}`)},
	{re: regexp.MustCompile(`\bsk-[A-Za-z0-9]{32,}\b`)},
	{re: regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{30,}\b`)},
	{re: regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{30,}\b`)},
	{re: regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9-]{10,}`)},
	{re: regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{35}\b`)},
	{re: regexp.MustCompile(`\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b`)},
	{re: regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`)},
	{re: regexp.MustCompile(`(?i)\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}`), keep: func(s []string) string { return s[1] + Mask }},
	// name=value, name: value and "name":"value" where the name says secret.
	{
		re: regexp.MustCompile(`(?i)\b([\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)[\w.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;&}]+)`),
		keep: func(s []string) string {
			// Short values are counts and flags ("secrets=0"), not secrets.
			if len(s[3]) < 4 || strings.HasPrefix(s[3], "<redacted") {
				return s[0]
			}
			return s[1] + s[2] + Mask
		},
	},
}

// String masks the credentials it recognises and reports how many.
func String(s string) (string, int) {
	n := 0
	for _, r := range rules {
		s = r.re.ReplaceAllStringFunc(s, func(m string) string {
			out := Mask
			if r.keep != nil {
				out = r.keep(r.re.FindStringSubmatch(m))
			}
			if out != m {
				n++
			}
			return out
		})
	}
	return s, n
}
