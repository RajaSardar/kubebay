package httpapi

import "strings"

// ownerDetailMaxLen caps a client-supplied owner label appended to an audit
// Detail string. The scale/restart/delete/cordon/drain endpoints don't fetch
// the target object server-side, so unlike apply's gitopsOwnerFromDoc (which
// reads the submitted manifest itself), this trusts the frontend's own
// already-computed label. That's fine for an audit-log annotation — it never
// gates a decision — but it must not let a client bloat the audit file.
const ownerDetailMaxLen = 100

// appendOwnerDetail appends " owner=<label>" to an audit Detail string when a
// GitOps owner label is present, capping the label defensively.
func appendOwnerDetail(detail, owner string) string {
	if owner == "" {
		return detail
	}
	if len(owner) > ownerDetailMaxLen {
		owner = owner[:ownerDetailMaxLen]
	}
	return detail + " owner=" + owner
}

// gitopsOwnerFromDoc mirrors web/apps/shell/src/lib/gitops.ts's ownerOf(): it
// detects Argo CD or Flux ownership from annotations already present on a
// parsed manifest, purely for audit-log context — never a security decision.
func gitopsOwnerFromDoc(doc map[string]interface{}) string {
	meta, _ := doc["metadata"].(map[string]interface{})
	annotations, _ := meta["annotations"].(map[string]interface{})
	if annotations == nil {
		return ""
	}
	str := func(k string) string {
		s, _ := annotations[k].(string)
		return s
	}
	if v := str("argocd.argoproj.io/instance"); v != "" {
		return "argocd:" + v
	}
	if v := str("argocd.argoproj.io/tracking-id"); v != "" {
		if i := strings.IndexByte(v, ':'); i != -1 {
			v = v[:i]
		}
		return "argocd:" + v
	}
	if v := str("kustomize.toolkit.fluxcd.io/name"); v != "" {
		return "flux:" + v
	}
	if v := str("helm.toolkit.fluxcd.io/name"); v != "" {
		return "flux:" + v
	}
	return ""
}
