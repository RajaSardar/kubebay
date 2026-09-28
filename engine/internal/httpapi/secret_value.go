package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
)

// decodeSecretKey extracts and base64-decodes one key from a Secret's
// unstructured `data` map. Kubernetes always stores Secret data values
// base64-encoded in the object itself, regardless of how they were created.
func decodeSecretKey(doc map[string]interface{}, key string) (string, error) {
	data, ok := doc["data"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("secret has no data block")
	}
	raw, ok := data[key]
	if !ok {
		return "", fmt.Errorf("key %q not found in secret", key)
	}
	rawStr, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("key %q is not a string value", key)
	}
	decoded, err := base64.StdEncoding.DecodeString(rawStr)
	if err != nil {
		return "", fmt.Errorf("decode key %q: %w", key, err)
	}
	return string(decoded), nil
}

func secretRevealAuditDetail(name, key string) string {
	return fmt.Sprintf("secret=%s key=%s", name, key)
}

// HandleGetSecretValue reveals exactly one key of one Secret — never the
// whole object — and records an audit entry on every successful reveal, so
// "who looked at this secret and when" stays answerable retroactively via
// /api/audit, the same discipline the admission-webhook debugger work
// (backlog #17) established for mutation rejections.
func (c *Channels) HandleGetSecretValue(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	q := r.URL.Query()
	cluster, ns, name, key := q.Get("cluster"), q.Get("ns"), q.Get("name"), q.Get("key")
	if cluster == "" || ns == "" || name == "" || key == "" {
		http.Error(w, "cluster, ns, name, key required", http.StatusBadRequest)
		return
	}

	d, err := c.dynClient(ctx, cluster)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	g, err := informers.ParseGVR("v1/secrets")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	obj, err := d.Resource(g).Namespace(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("get: %v", err), http.StatusBadGateway)
		return
	}
	value, err := decodeSecretKey(obj.UnstructuredContent(), key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	c.Audit.Record(audit.Entry{
		Action:    "secret-reveal",
		Cluster:   cluster,
		Namespace: ns,
		Resource:  name,
		Detail:    secretRevealAuditDetail(name, key),
		UserAgent: r.Header.Get("User-Agent"),
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"value": value})
}
