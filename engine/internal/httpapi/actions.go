package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
)

type Actions struct {
	Clusters *clusters.Manager
}

func (a *Actions) dyn(cluster string) (dynamic.Interface, error) {
	cfg, err := a.Clusters.RestConfig(cluster)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	return dynamic.NewForConfig(cfg)
}

func mustGVR(s string) (schema.GroupVersionResource, error) {
	return informers.ParseGVR(s)
}

func (a *Actions) Scale(ctx context.Context, cluster, gvr, ns, name string, replicas int64) error {
	d, err := a.dyn(cluster)
	if err != nil {
		return err
	}
	g, err := mustGVR(gvr)
	if err != nil {
		return err
	}
	ri := d.Resource(g)
	obj, err := ri.Namespace(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("get: %w", err)
	}
	if err := setNestedReplicas(obj.Object, replicas); err != nil {
		return err
	}
	_, err = ri.Namespace(ns).Update(ctx, obj, metav1.UpdateOptions{FieldManager: "kubebay"})
	return err
}

func setNestedReplicas(obj map[string]interface{}, replicas int64) error {
	spec, ok := obj["spec"].(map[string]interface{})
	if !ok {
		spec = map[string]interface{}{}
		obj["spec"] = spec
	}
	spec["replicas"] = replicas
	return nil
}

func (a *Actions) Restart(ctx context.Context, cluster, gvr, ns, name string) error {
	d, err := a.dyn(cluster)
	if err != nil {
		return err
	}
	g, err := mustGVR(gvr)
	if err != nil {
		return err
	}
	patch := []byte(fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":%q}}}}}`, time.Now().UTC().Format(time.RFC3339)))
	_, err = d.Resource(g).Namespace(ns).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{FieldManager: "kubebay"})
	return err
}

func (a *Actions) Delete(ctx context.Context, cluster, gvr, ns, name string) error {
	d, err := a.dyn(cluster)
	if err != nil {
		return err
	}
	g, err := mustGVR(gvr)
	if err != nil {
		return err
	}
	if ns != "" {
		return d.Resource(g).Namespace(ns).Delete(ctx, name, metav1.DeleteOptions{})
	}
	return d.Resource(g).Delete(ctx, name, metav1.DeleteOptions{})
}

func decodeBody(r *http.Request, v interface{}) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	return dec.Decode(v)
}
