package httpapi

import (
	"context"
	crand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	policyapiv1 "k8s.io/api/policy/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
)

type Actions struct {
	Clusters *clusters.Manager
}

func (a *Actions) dyn(ctx context.Context, cluster string) (dynamic.Interface, error) {
	cfg, err := a.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	return dynamic.NewForConfig(cfg)
}

func mustGVR(s string) (schema.GroupVersionResource, error) {
	return informers.ParseGVR(s)
}

func (a *Actions) Scale(ctx context.Context, cluster, gvr, ns, name string, replicas int64) error {
	d, err := a.dyn(ctx, cluster)
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
	d, err := a.dyn(ctx, cluster)
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

func (a *Actions) Delete(ctx context.Context, cluster, gvr, ns, name string, graceSeconds *int64, forceFinalizers bool) error {
	d, err := a.dyn(ctx, cluster)
	if err != nil {
		return err
	}
	g, err := mustGVR(gvr)
	if err != nil {
		return err
	}
	ri := d.Resource(g)
	if forceFinalizers {
		var obj interface{}
		if ns != "" {
			obj, err = ri.Namespace(ns).Get(ctx, name, metav1.GetOptions{})
		} else {
			obj, err = ri.Get(ctx, name, metav1.GetOptions{})
		}
		if err == nil {
			if u, ok := obj.(interface{ UnstructuredContent() map[string]interface{} }); ok {
				if meta, ok := u.UnstructuredContent()["metadata"].(map[string]interface{}); ok {
					if fl, ok := meta["finalizers"].([]interface{}); ok && len(fl) > 0 {
						fp := []byte(`{"metadata":{"finalizers":null}}`)
						if ns != "" {
							_, _ = ri.Namespace(ns).Patch(ctx, name, types.MergePatchType, fp, metav1.PatchOptions{FieldManager: "kubebay"})
						} else {
							_, _ = ri.Patch(ctx, name, types.MergePatchType, fp, metav1.PatchOptions{FieldManager: "kubebay"})
						}
					}
				}
			}
		}
	}
	opts := metav1.DeleteOptions{}
	if graceSeconds != nil {
		opts.GracePeriodSeconds = graceSeconds
	}
	if ns != "" {
		return ri.Namespace(ns).Delete(ctx, name, opts)
	}
	return ri.Delete(ctx, name, opts)
}

func (a *Actions) ResizePod(ctx context.Context, cluster, ns, podName, container string, res map[string]interface{}) error {
	if container == "" {
		return fmt.Errorf("container required")
	}
	d, err := a.dyn(ctx, cluster)
	if err != nil {
		return err
	}
	g, err := mustGVR("v1/pods")
	if err != nil {
		return err
	}
	resources := map[string]interface{}{}
	for _, section := range []string{"requests", "limits"} {
		if m, ok := res[section].(map[string]interface{}); ok && len(m) > 0 {
			resources[section] = m
		}
	}
	if len(resources) == 0 {
		return fmt.Errorf("no resources provided")
	}
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"containers": []interface{}{
				map[string]interface{}{"name": container, "resources": resources},
			},
		},
	}
	data, err := json.Marshal(patch)
	if err != nil {
		return err
	}
	_, err = d.Resource(g).Namespace(ns).Patch(ctx, podName, types.StrategicMergePatchType, data, metav1.PatchOptions{FieldManager: "kubebay"})
	return err
}

func decodeBody(r *http.Request, v interface{}) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	return dec.Decode(v)
}

func (a *Actions) Cordon(ctx context.Context, cluster, node string, cordon bool) error {
	d, err := a.dyn(ctx, cluster)
	if err != nil {
		return err
	}
	g, err := mustGVR("v1/nodes")
	if err != nil {
		return err
	}
	patch := []byte(fmt.Sprintf(`{"spec":{"unschedulable":%t}}`, cordon))
	_, err = d.Resource(g).Patch(ctx, node, types.MergePatchType, patch, metav1.PatchOptions{FieldManager: "kubebay"})
	return err
}

type DrainSummary struct {
	Evicted []string          `json:"evicted"`
	Skipped []string          `json:"skipped"`
	Errors  map[string]string `json:"errors,omitempty"`
}

func (a *Actions) Drain(ctx context.Context, cluster, node string, ignoreDaemonsets bool) (*DrainSummary, error) {
	cfg, err := a.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(ctx))
	if err != nil {
		return nil, err
	}
	cs, derr := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, derr
	}
	if err := a.Cordon(ctx, cluster, node, true); err != nil {
		return nil, fmt.Errorf("cordon: %w", err)
	}

	sum := &DrainSummary{Evicted: []string{}, Skipped: []string{}, Errors: map[string]string{}}
	pods, err := cs.CoreV1().Pods(metav1.NamespaceAll).List(ctx, metav1.ListOptions{
		FieldSelector: "spec.nodeName=" + node,
	})
	if err != nil {
		return nil, err
	}
	for _, p := range pods.Items {
		name := p.Namespace + "/" + p.Name
		if _, ok := p.ObjectMeta.Annotations["kubernetes.io/config.mirror"]; ok {
			sum.Skipped = append(sum.Skipped, name+" (mirror)")
			continue
		}
		ownerKind := ""
		for _, or := range p.OwnerReferences {
			ownerKind = or.Kind
		}
		if ownerKind == "DaemonSet" && !ignoreDaemonsets {
			sum.Skipped = append(sum.Skipped, name+" (daemonset)")
			continue
		}
		if p.Status.Phase == corev1.PodSucceeded || p.Status.Phase == corev1.PodFailed {
			continue
		}
		ev := &policyapiv1.Eviction{
			ObjectMeta: metav1.ObjectMeta{Name: p.Name, Namespace: p.Namespace},
		}
		var lastErr error
		ok := false
		for attempt := 0; attempt < 5; attempt++ {
			err := cs.PolicyV1().Evictions(p.Namespace).Evict(ctx, ev)
			if err == nil {
				ok = true
				break
			}
			if apierrors.IsTooManyRequests(err) && strings.Contains(err.Error(), "Cannot evict pod as it would violate") {
				time.Sleep(3 * time.Second)
				lastErr = err
				continue
			}
			lastErr = err
			break
		}
		if ok {
			sum.Evicted = append(sum.Evicted, name)
		} else if lastErr != nil {
			sum.Errors[name] = lastErr.Error()
		}
	}
	return sum, nil
}

func (a *Actions) TriggerCronJob(ctx context.Context, cluster, ns, name string) (string, error) {
	cfg, err := a.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(ctx))
	if err != nil {
		return "", err
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return "", err
	}
	cj, err := cs.BatchV1().CronJobs(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	suffix, _ := randHex(5)
	jobName := fmt.Sprintf("%s-manual-%s", name, suffix)
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:            jobName,
			Namespace:       ns,
			Labels:          map[string]string{"kubebay.io/triggered-from": cj.Name},
			Annotations:     map[string]string{"kubebay.io/triggered-at": time.Now().UTC().Format(time.RFC3339)},
			OwnerReferences: []metav1.OwnerReference{{APIVersion: "batch/v1", Kind: "CronJob", Name: cj.Name, UID: cj.UID, Controller: boolPtrT(true)}},
		},
		Spec: *cj.Spec.JobTemplate.Spec.DeepCopy(),
	}
	_, err = cs.BatchV1().Jobs(ns).Create(ctx, job, metav1.CreateOptions{})
	return jobName, err
}

func (a *Actions) SetCronSuspend(ctx context.Context, cluster, ns, name string, suspend bool) error {
	cfg, err := a.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(ctx))
	if err != nil {
		return err
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return err
	}
	patch := []byte(fmt.Sprintf(`{"spec":{"suspend":%t}}`, suspend))
	_, err = cs.BatchV1().CronJobs(ns).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{FieldManager: "kubebay"})
	return err
}

func ptrTrue() *bool { t := true; return &t }

func boolPtrT(b bool) *bool { return &b }

func randHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := crand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
