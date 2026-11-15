package httpapi

import (
	"fmt"
	"strings"
)

// Finding is one RBAC smell: a real subject (via a real binding) holding a
// permission worth a second look. Suggestions are text to copy into a role
// definition — never applied automatically.
type Finding struct {
	Severity   string `json:"severity"` // "high" | "medium"
	Title      string `json:"title"`
	Subject    string `json:"subject"`
	RoleRef    string `json:"roleRef"`
	Why        string `json:"why"`
	Rule       string `json:"rule,omitempty"`
	Suggestion string `json:"suggestion,omitempty"`
	// Optional query hint the frontend can use to pre-fill "who else can do
	// this" — left empty when a finding doesn't map to one specific check.
	Verb     string `json:"verb,omitempty"`
	Group    string `json:"group,omitempty"`
	Resource string `json:"resource,omitempty"`
}

// roleRisk is an internal, role-level (not yet subject-attached) finding
// candidate. It only becomes a real Finding once a binding proves some real
// subject actually holds it — a risky role nobody is bound to grants nobody
// anything.
type roleRisk struct {
	severity              string
	title                 string
	why                   string
	rule                  string
	suggestion            string
	verb, group, resource string
}

func containsStr(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func ruleText(r Rule) string {
	return fmt.Sprintf("verbs=%v resources=%v apiGroups=%v", r.Verbs, r.Resources, r.APIGroups)
}

// roleRisks returns the independent risks found in a role's own rules,
// deduplicated by title so a role with several matching rules doesn't
// produce repeat findings once bound to a subject.
func roleRisks(role RoleSummary) []roleRisk {
	var risks []roleRisk
	seen := map[string]bool{}
	add := func(r roleRisk) {
		if seen[r.title] {
			return
		}
		seen[r.title] = true
		risks = append(risks, r)
	}

	for _, rule := range role.Rules {
		wildcardVerb := containsStr(rule.Verbs, "*")
		wildcardResource := containsStr(rule.Resources, "*")
		wildcardGroup := containsStr(rule.APIGroups, "*")

		if wildcardVerb && wildcardResource && wildcardGroup {
			title := "Full cluster-admin-equivalent access"
			if role.Kind == "ClusterRole" && role.Name == "cluster-admin" {
				title = "Bound to the built-in cluster-admin role"
			}
			add(roleRisk{
				severity:   "high",
				title:      title,
				why:        "grants every verb on every resource in every API group — equivalent to cluster-admin",
				rule:       ruleText(rule),
				suggestion: "Replace with a role scoped to only the specific verbs, resources, and apiGroups actually needed.",
			})
			continue
		}
		if wildcardVerb {
			add(roleRisk{
				severity:   "high",
				title:      "Wildcard verb (*)",
				why:        "grants every action (get, delete, patch, ...) on the listed resources, not just the ones actually used",
				rule:       ruleText(rule),
				suggestion: "List the specific verbs this role actually needs instead of \"*\".",
			})
		}
		if wildcardResource {
			add(roleRisk{
				severity:   "high",
				title:      "Wildcard resource (*)",
				why:        "grants access to every resource type in the listed API groups, not just the ones actually used",
				rule:       ruleText(rule),
				suggestion: "List the specific resource types this role actually needs instead of \"*\".",
			})
		}
		if wildcardGroup {
			add(roleRisk{
				severity:   "medium",
				title:      "Wildcard apiGroup (*)",
				why:        "grants access across every API group, not just the ones actually needed",
				rule:       ruleText(rule),
				suggestion: "List the specific apiGroups this role actually needs instead of \"*\".",
			})
		}

		var escalationVerbs []string
		for _, v := range []string{"escalate", "bind", "impersonate"} {
			if containsStr(rule.Verbs, v) {
				escalationVerbs = append(escalationVerbs, v)
			}
		}
		if len(escalationVerbs) > 0 {
			add(roleRisk{
				severity: "high",
				title:    "Privilege-escalation verb(s) present",
				why: fmt.Sprintf(
					"%s lets this subject grant itself (or others) permissions beyond what this role itself lists",
					strings.Join(escalationVerbs, ", "),
				),
				rule:       ruleText(rule),
				suggestion: "Remove escalate/bind/impersonate unless this subject genuinely needs to manage other subjects' RBAC.",
			})
		}

		hasNoResourceNames := len(rule.ResourceNames) == 0
		readVerb := containsStr(rule.Verbs, "get") || containsStr(rule.Verbs, "list") || containsStr(rule.Verbs, "watch")
		if role.Kind == "ClusterRole" && hasNoResourceNames && !wildcardVerb && readVerb &&
			(containsStr(rule.Resources, "secrets") || wildcardResource) {
			add(roleRisk{
				severity:   "high",
				title:      "Cluster-wide Secret read access",
				why:        "can read every Secret in every namespace, not just specific ones",
				rule:       ruleText(rule),
				suggestion: "Scope this rule to a namespaced Role, or add resourceNames to limit it to specific Secrets.",
				verb:       "get",
				group:      "",
				resource:   "secrets",
			})
		}

		execVerb := containsStr(rule.Verbs, "create") || wildcardVerb
		if role.Kind == "ClusterRole" && hasNoResourceNames && execVerb &&
			(containsStr(rule.Resources, "pods/exec") || wildcardResource) {
			add(roleRisk{
				severity:   "high",
				title:      "Cluster-wide pod exec access",
				why:        "can exec into any pod in any namespace, not just specific ones",
				rule:       ruleText(rule),
				suggestion: "Scope this rule to a namespaced Role, or add resourceNames to limit it to specific pods.",
				verb:       "create",
				group:      "",
				resource:   "pods/exec",
			})
		}
	}
	return risks
}

func subjectLabel(s Subject) string {
	if s.Kind == "ServiceAccount" {
		return fmt.Sprintf("ServiceAccount %s/%s", s.Namespace, s.Name)
	}
	return fmt.Sprintf("%s %s", s.Kind, s.Name)
}

// AnalyzeRBAC is a static rule engine over an already-fetched RBACSnapshot —
// no cluster round-trip of its own. existingServiceAccounts is a set of
// "namespace/name" keys used only to flag bindings pointing at a
// ServiceAccount that no longer exists; pass nil to skip that check.
func AnalyzeRBAC(snap RBACSnapshot, existingServiceAccounts map[string]bool) []Finding {
	var findings []Finding

	roleByRef := map[string]RoleSummary{}
	for _, r := range snap.ClusterRoles {
		roleByRef["ClusterRole:"+r.Name] = r
	}
	for _, r := range snap.Roles {
		// Roles are namespaced, but bindings reference them by name only
		// within their own namespace, so key on ns+name.
		roleByRef["Role:"+r.NS+"/"+r.Name] = r
	}

	riskFindingsFor := func(b BindingSummary) []Finding {
		var role RoleSummary
		var ok bool
		if strings.HasPrefix(b.RoleRef, "ClusterRole:") {
			role, ok = roleByRef[b.RoleRef]
		} else {
			name := strings.TrimPrefix(b.RoleRef, "Role:")
			role, ok = roleByRef["Role:"+b.NS+"/"+name]
		}
		var out []Finding
		if ok {
			for _, risk := range roleRisks(role) {
				for _, s := range b.Subjects {
					out = append(out, Finding{
						Severity:   risk.severity,
						Title:      risk.title,
						Subject:    subjectLabel(s),
						RoleRef:    b.RoleRef,
						Why:        risk.why,
						Rule:       risk.rule,
						Suggestion: risk.suggestion,
						Verb:       risk.verb,
						Group:      risk.group,
						Resource:   risk.resource,
					})
				}
			}
		}
		if existingServiceAccounts != nil {
			for _, s := range b.Subjects {
				if s.Kind != "ServiceAccount" {
					continue
				}
				key := s.Namespace + "/" + s.Name
				if !existingServiceAccounts[key] {
					out = append(out, Finding{
						Severity: "medium",
						Title:    "ServiceAccount subject does not exist",
						Subject:  subjectLabel(s),
						RoleRef:  b.RoleRef,
						Why:      "this binding grants access to a ServiceAccount that isn't in the cluster — dead weight, or a sign something was deleted out of order",
					})
				}
			}
		}
		return out
	}

	for _, b := range snap.ClusterRoleBindings {
		findings = append(findings, riskFindingsFor(b)...)
	}
	for _, b := range snap.RoleBindings {
		findings = append(findings, riskFindingsFor(b)...)
	}

	return findings
}
