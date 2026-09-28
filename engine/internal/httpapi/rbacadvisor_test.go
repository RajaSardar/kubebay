package httpapi

import "testing"

func hasFindingTitled(findings []Finding, title string) bool {
	for _, f := range findings {
		if f.Title == title {
			return true
		}
	}
	return false
}

func countFindingsTitled(findings []Finding, title string) int {
	n := 0
	for _, f := range findings {
		if f.Title == title {
			n++
		}
	}
	return n
}

func TestAnalyzeRBAC_CleanSnapshotHasNoFindings(t *testing.T) {
	snap := RBACSnapshot{
		ClusterRoles: []RoleSummary{
			{Name: "pod-reader", Kind: "ClusterRole", Rules: []Rule{{Verbs: []string{"get", "list"}, APIGroups: []string{""}, Resources: []string{"pods"}}}},
		},
		ClusterRoleBindings: []BindingSummary{
			{Name: "b1", Kind: "ClusterRoleBinding", RoleRef: "ClusterRole:pod-reader", Subjects: []Subject{{Kind: "ServiceAccount", Name: "reader", Namespace: "default"}}},
		},
	}
	findings := AnalyzeRBAC(snap, map[string]bool{"default/reader": true})
	if len(findings) != 0 {
		t.Fatalf("want no findings, got %+v", findings)
	}
}

func TestAnalyzeRBAC_FullWildcardRole(t *testing.T) {
	snap := RBACSnapshot{
		ClusterRoles: []RoleSummary{
			{Name: "super", Kind: "ClusterRole", Rules: []Rule{{Verbs: []string{"*"}, APIGroups: []string{"*"}, Resources: []string{"*"}}}},
		},
		ClusterRoleBindings: []BindingSummary{
			{Name: "b1", Kind: "ClusterRoleBinding", RoleRef: "ClusterRole:super", Subjects: []Subject{{Kind: "ServiceAccount", Name: "sa1", Namespace: "default"}}},
		},
	}
	findings := AnalyzeRBAC(snap, map[string]bool{"default/sa1": true})
	if !hasFindingTitled(findings, "Full cluster-admin-equivalent access") {
		t.Fatalf("want a full-access finding, got %+v", findings)
	}
	// Should not also separately report wildcard verb/resource/group — the
	// full-access finding subsumes them so the list stays readable.
	if hasFindingTitled(findings, "Wildcard verb (*)") {
		t.Errorf("full-access finding should subsume the individual wildcard findings, got %+v", findings)
	}
	f := findings[0]
	if f.Severity != "high" {
		t.Errorf("severity = %q, want high", f.Severity)
	}
	if f.Subject == "" || f.RoleRef == "" {
		t.Errorf("Subject/RoleRef should be populated: %+v", f)
	}
}

func TestAnalyzeRBAC_NamesTheBuiltInClusterAdminRoleSpecifically(t *testing.T) {
	snap := RBACSnapshot{
		ClusterRoles: []RoleSummary{
			{Name: "cluster-admin", Kind: "ClusterRole", Rules: []Rule{{Verbs: []string{"*"}, APIGroups: []string{"*"}, Resources: []string{"*"}}}},
		},
		ClusterRoleBindings: []BindingSummary{
			{Name: "cluster-admin", Kind: "ClusterRoleBinding", RoleRef: "ClusterRole:cluster-admin", Subjects: []Subject{{Kind: "User", Name: "alice"}}},
		},
	}
	findings := AnalyzeRBAC(snap, nil)
	if !hasFindingTitled(findings, "Bound to the built-in cluster-admin role") {
		t.Fatalf("want the cluster-admin-specific finding, got %+v", findings)
	}
	if countFindingsTitled(findings, "Full cluster-admin-equivalent access") != 0 {
		t.Errorf("cluster-admin should get its specific title, not the generic one too: %+v", findings)
	}
}

func TestAnalyzeRBAC_WildcardVerbOnly(t *testing.T) {
	snap := RBACSnapshot{
		Roles: []RoleSummary{
			{Name: "r1", NS: "default", Kind: "Role", Rules: []Rule{{Verbs: []string{"*"}, APIGroups: []string{""}, Resources: []string{"configmaps"}}}},
		},
		RoleBindings: []BindingSummary{
			{Name: "b1", NS: "default", Kind: "RoleBinding", RoleRef: "Role:r1", Subjects: []Subject{{Kind: "ServiceAccount", Name: "sa1", Namespace: "default"}}},
		},
	}
	findings := AnalyzeRBAC(snap, map[string]bool{"default/sa1": true})
	if !hasFindingTitled(findings, "Wildcard verb (*)") {
		t.Fatalf("want a wildcard-verb finding, got %+v", findings)
	}
}

func TestAnalyzeRBAC_PrivilegeEscalationVerbs(t *testing.T) {
	snap := RBACSnapshot{
		ClusterRoles: []RoleSummary{
			{Name: "escalator", Kind: "ClusterRole", Rules: []Rule{{Verbs: []string{"escalate", "bind"}, APIGroups: []string{"rbac.authorization.k8s.io"}, Resources: []string{"clusterroles"}}}},
		},
		ClusterRoleBindings: []BindingSummary{
			{Name: "b1", Kind: "ClusterRoleBinding", RoleRef: "ClusterRole:escalator", Subjects: []Subject{{Kind: "ServiceAccount", Name: "sa1", Namespace: "default"}}},
		},
	}
	findings := AnalyzeRBAC(snap, map[string]bool{"default/sa1": true})
	if len(findings) != 1 {
		t.Fatalf("want exactly one finding covering both verbs, got %+v", findings)
	}
	if findings[0].Severity != "high" {
		t.Errorf("severity = %q, want high", findings[0].Severity)
	}
}

func TestAnalyzeRBAC_ClusterWideSecretsRead(t *testing.T) {
	risky := RoleSummary{Name: "secret-reader", Kind: "ClusterRole", Rules: []Rule{{Verbs: []string{"get", "list"}, APIGroups: []string{""}, Resources: []string{"secrets"}}}}
	binding := BindingSummary{Name: "b1", Kind: "ClusterRoleBinding", RoleRef: "ClusterRole:secret-reader", Subjects: []Subject{{Kind: "ServiceAccount", Name: "sa1", Namespace: "default"}}}

	t.Run("flags a ClusterRole with no resourceNames", func(t *testing.T) {
		snap := RBACSnapshot{ClusterRoles: []RoleSummary{risky}, ClusterRoleBindings: []BindingSummary{binding}}
		findings := AnalyzeRBAC(snap, map[string]bool{"default/sa1": true})
		if !hasFindingTitled(findings, "Cluster-wide Secret read access") {
			t.Fatalf("want a cluster-wide secrets finding, got %+v", findings)
		}
	})

	t.Run("does not flag when scoped to specific resourceNames", func(t *testing.T) {
		scoped := risky
		scoped.Rules = []Rule{{Verbs: []string{"get", "list"}, APIGroups: []string{""}, Resources: []string{"secrets"}, ResourceNames: []string{"my-specific-secret"}}}
		snap := RBACSnapshot{ClusterRoles: []RoleSummary{scoped}, ClusterRoleBindings: []BindingSummary{binding}}
		findings := AnalyzeRBAC(snap, map[string]bool{"default/sa1": true})
		if hasFindingTitled(findings, "Cluster-wide Secret read access") {
			t.Errorf("a resourceNames-scoped rule should not be flagged as cluster-wide, got %+v", findings)
		}
	})

	t.Run("does not flag a namespaced Role for the same rule", func(t *testing.T) {
		nsRole := risky
		nsRole.Kind = "Role"
		nsRole.NS = "default"
		nsBinding := BindingSummary{Name: "b1", NS: "default", Kind: "RoleBinding", RoleRef: "Role:secret-reader", Subjects: binding.Subjects}
		snap := RBACSnapshot{Roles: []RoleSummary{nsRole}, RoleBindings: []BindingSummary{nsBinding}}
		findings := AnalyzeRBAC(snap, map[string]bool{"default/sa1": true})
		if hasFindingTitled(findings, "Cluster-wide Secret read access") {
			t.Errorf("a namespaced Role granting secrets in its own namespace is normal, got %+v", findings)
		}
	})
}

func TestAnalyzeRBAC_ClusterWidePodsExec(t *testing.T) {
	snap := RBACSnapshot{
		ClusterRoles: []RoleSummary{
			{Name: "exec-all", Kind: "ClusterRole", Rules: []Rule{{Verbs: []string{"create"}, APIGroups: []string{""}, Resources: []string{"pods/exec"}}}},
		},
		ClusterRoleBindings: []BindingSummary{
			{Name: "b1", Kind: "ClusterRoleBinding", RoleRef: "ClusterRole:exec-all", Subjects: []Subject{{Kind: "ServiceAccount", Name: "sa1", Namespace: "default"}}},
		},
	}
	findings := AnalyzeRBAC(snap, map[string]bool{"default/sa1": true})
	if !hasFindingTitled(findings, "Cluster-wide pod exec access") {
		t.Fatalf("want a cluster-wide exec finding, got %+v", findings)
	}
}

func TestAnalyzeRBAC_OneFindingPerSubjectOnASharedRiskyBinding(t *testing.T) {
	snap := RBACSnapshot{
		ClusterRoles: []RoleSummary{
			{Name: "cluster-admin", Kind: "ClusterRole", Rules: []Rule{{Verbs: []string{"*"}, APIGroups: []string{"*"}, Resources: []string{"*"}}}},
		},
		ClusterRoleBindings: []BindingSummary{
			{Name: "b1", Kind: "ClusterRoleBinding", RoleRef: "ClusterRole:cluster-admin", Subjects: []Subject{
				{Kind: "ServiceAccount", Name: "sa1", Namespace: "default"},
				{Kind: "ServiceAccount", Name: "sa2", Namespace: "default"},
			}},
		},
	}
	findings := AnalyzeRBAC(snap, map[string]bool{"default/sa1": true, "default/sa2": true})
	if countFindingsTitled(findings, "Bound to the built-in cluster-admin role") != 2 {
		t.Fatalf("want one finding per subject, got %+v", findings)
	}
}

func TestAnalyzeRBAC_UnboundRiskyRoleProducesNoFinding(t *testing.T) {
	snap := RBACSnapshot{
		ClusterRoles: []RoleSummary{
			{Name: "super", Kind: "ClusterRole", Rules: []Rule{{Verbs: []string{"*"}, APIGroups: []string{"*"}, Resources: []string{"*"}}}},
		},
	}
	findings := AnalyzeRBAC(snap, nil)
	if len(findings) != 0 {
		t.Fatalf("a role with no bindings grants nobody anything, want no findings, got %+v", findings)
	}
}

func TestAnalyzeRBAC_DanglingServiceAccountSubject(t *testing.T) {
	snap := RBACSnapshot{
		ClusterRoles: []RoleSummary{
			{Name: "pod-reader", Kind: "ClusterRole", Rules: []Rule{{Verbs: []string{"get"}, APIGroups: []string{""}, Resources: []string{"pods"}}}},
		},
		ClusterRoleBindings: []BindingSummary{
			{Name: "b1", Kind: "ClusterRoleBinding", RoleRef: "ClusterRole:pod-reader", Subjects: []Subject{{Kind: "ServiceAccount", Name: "ghost", Namespace: "default"}}},
		},
	}
	findings := AnalyzeRBAC(snap, map[string]bool{})
	if !hasFindingTitled(findings, "ServiceAccount subject does not exist") {
		t.Fatalf("want a dangling-subject finding, got %+v", findings)
	}
}

func TestAnalyzeRBAC_IgnoresNonServiceAccountSubjectsForDanglingCheck(t *testing.T) {
	snap := RBACSnapshot{
		ClusterRoles: []RoleSummary{
			{Name: "pod-reader", Kind: "ClusterRole", Rules: []Rule{{Verbs: []string{"get"}, APIGroups: []string{""}, Resources: []string{"pods"}}}},
		},
		ClusterRoleBindings: []BindingSummary{
			{Name: "b1", Kind: "ClusterRoleBinding", RoleRef: "ClusterRole:pod-reader", Subjects: []Subject{{Kind: "User", Name: "alice"}}},
		},
	}
	findings := AnalyzeRBAC(snap, map[string]bool{})
	if hasFindingTitled(findings, "ServiceAccount subject does not exist") {
		t.Errorf("a User subject can't be checked for existence this way, got %+v", findings)
	}
}
