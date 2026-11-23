package httpapi

import (
	"net/http"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// auditHandler serves GET /api/audit: Kubebay's own audit log, optionally
// narrowed by ?cluster=&namespace=&resource= (the drawer's Timeline tab),
// ?user= and ?kind= (a full GVR or its plural resource).
//
// Kubebay has no admin role, so an OIDC user only ever sees entries they
// made: their identity replaces any ?user= they send. Without OIDC (the
// desktop app, a loopback engine) there is one local user and every entry is
// shown.
func auditHandler(lg *audit.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		f := audit.Filter{
			Cluster: q.Get("cluster"), Namespace: q.Get("namespace"), Resource: q.Get("resource"),
			User: q.Get("user"), Kind: q.Get("kind"),
		}
		if ident := clusters.IdentityFromContext(r.Context()); ident != nil {
			if f.User != "" && f.User != ident.Name {
				writeJSON(w, []audit.Entry{})
				return
			}
			f.User = audit.UserFrom(r.Context())
		}
		entries, err := lg.Query(f, 500)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if entries == nil {
			entries = []audit.Entry{}
		}
		writeJSON(w, entries)
	}
}

// Kinds for audit entries about Helm, which has no Kubernetes resource of
// its own: a release is several Secrets, a repository is local config.
const (
	helmReleaseGVR = "helm/releases"
	helmRepoGVR    = "helm/repositories"
)

// gvrString writes g in the "group/version/resource" form the UI and
// informers.ParseGVR use ("v1/pods" for the core group).
func gvrString(g schema.GroupVersionResource) string {
	if g.Group == "" {
		return g.Version + "/" + g.Resource
	}
	return g.Group + "/" + g.Version + "/" + g.Resource
}
