package httpapi

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
)

// secretMask stands in for a Secret's values wherever the object is shown.
const secretMask = "<hidden>"

func isSecret(doc map[string]interface{}) bool {
	k, _ := doc["kind"].(string)
	v, _ := doc["apiVersion"].(string)
	return k == "Secret" && v == "v1"
}

// maskSecret hides every value a Secret holds, keeping its keys so you can see
// what is in it. last-applied-configuration is hidden too: for an object made
// with kubectl apply it is a second copy of the manifest, data included.
func maskSecret(doc map[string]interface{}) {
	for _, field := range []string{"data", "stringData"} {
		if m, ok := doc[field].(map[string]interface{}); ok {
			for k := range m {
				m[k] = secretMask
			}
		}
	}
	if meta, ok := doc["metadata"].(map[string]interface{}); ok {
		if ann, ok := meta["annotations"].(map[string]interface{}); ok {
			if _, has := ann[lastAppliedAnnotation]; has {
				ann[lastAppliedAnnotation] = secretMask
			}
		}
	}
}

// auditSecretReveal records that a Secret's whole YAML was asked for with its
// values, the same entry the single-key reveal leaves.
func (c *Channels) auditSecretReveal(r *http.Request, cluster, ns, name string) {
	c.Audit.Record(audit.Entry{
		Action:    "secret-reveal",
		Cluster:   cluster,
		Namespace: ns,
		Resource:  name,
		Detail:    fmt.Sprintf("secret=%s keys=all (yaml)", name),
		UserAgent: r.Header.Get("User-Agent"),
	})
}

// editsMaskedSecretValue reports whether an edit of a Secret changes a value
// the editor only ever showed as the placeholder. Such an edit has nothing real
// to be diffed against, so it is refused; changes elsewhere are fine, because
// an untouched placeholder is the same on both sides and never reaches the patch.
func editsMaskedSecretValue(doc map[string]interface{}, original string, changed []string) bool {
	if !isSecret(doc) || !strings.Contains(original, secretMask) {
		return false
	}
	for _, p := range changed {
		if strings.HasPrefix(p, "data.") || strings.HasPrefix(p, "stringData.") {
			return true
		}
	}
	return false
}
