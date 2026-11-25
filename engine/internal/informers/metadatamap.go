package informers

import (
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// metadataMap is o as runtime.DefaultUnstructuredConverter.ToUnstructured
// makes it, written out by hand: a metadata informer's object is converted
// once, as it enters the cache, instead of through a JSON round trip for
// every op (194 allocations) and the reflection converter twice for every
// timeline observation (232). An object with a field set still in it (the
// transform trims them) goes through the converter.
func metadataMap(o *metav1.PartialObjectMetadata) map[string]any {
	for i := range o.ManagedFields {
		if o.ManagedFields[i].FieldsV1 != nil {
			m, err := runtime.DefaultUnstructuredConverter.ToUnstructured(o)
			if err != nil {
				return nil
			}
			return m
		}
	}
	out := make(map[string]any, 3)
	if o.APIVersion != "" {
		out["apiVersion"] = o.APIVersion
	}
	if o.Kind != "" {
		out["kind"] = o.Kind
	}
	out["metadata"] = objectMetaMap(&o.ObjectMeta)
	return out
}

func objectMetaMap(m *metav1.ObjectMeta) map[string]any {
	out := make(map[string]any, 16)
	putString(out, "name", m.Name)
	putString(out, "generateName", m.GenerateName)
	putString(out, "namespace", m.Namespace)
	putString(out, "selfLink", m.SelfLink)
	putString(out, "uid", string(m.UID))
	putString(out, "resourceVersion", m.ResourceVersion)
	if m.Generation != 0 {
		out["generation"] = m.Generation
	}
	if !m.CreationTimestamp.IsZero() {
		out["creationTimestamp"] = timeString(m.CreationTimestamp.Time)
	}
	if m.DeletionTimestamp != nil {
		out["deletionTimestamp"] = timeValue(m.DeletionTimestamp)
	}
	if m.DeletionGracePeriodSeconds != nil {
		out["deletionGracePeriodSeconds"] = *m.DeletionGracePeriodSeconds
	}
	putStringMap(out, "labels", m.Labels)
	putStringMap(out, "annotations", m.Annotations)
	if len(m.OwnerReferences) > 0 {
		refs := make([]any, len(m.OwnerReferences))
		for i, r := range m.OwnerReferences {
			ref := make(map[string]any, 6)
			ref["apiVersion"], ref["kind"], ref["name"], ref["uid"] = r.APIVersion, r.Kind, r.Name, string(r.UID)
			if r.Controller != nil {
				ref["controller"] = *r.Controller
			}
			if r.BlockOwnerDeletion != nil {
				ref["blockOwnerDeletion"] = *r.BlockOwnerDeletion
			}
			refs[i] = ref
		}
		out["ownerReferences"] = refs
	}
	if len(m.Finalizers) > 0 {
		fs := make([]any, len(m.Finalizers))
		for i, f := range m.Finalizers {
			fs[i] = f
		}
		out["finalizers"] = fs
	}
	if len(m.ManagedFields) > 0 {
		mfs := make([]any, len(m.ManagedFields))
		for i, f := range m.ManagedFields {
			e := make(map[string]any, 6)
			putString(e, "manager", f.Manager)
			putString(e, "operation", string(f.Operation))
			putString(e, "apiVersion", f.APIVersion)
			if f.Time != nil {
				e["time"] = timeValue(f.Time)
			}
			putString(e, "fieldsType", f.FieldsType)
			putString(e, "subresource", f.Subresource)
			mfs[i] = e
		}
		out["managedFields"] = mfs
	}
	return out
}

func putString(m map[string]any, k, v string) {
	if v != "" {
		m[k] = v
	}
}

func putStringMap(m map[string]any, k string, v map[string]string) {
	if len(v) == 0 {
		return
	}
	o := make(map[string]any, len(v))
	for a, b := range v {
		o[a] = b
	}
	m[k] = o
}

// timeValue is a *metav1.Time as the converter writes it: RFC 3339 in UTC,
// or nil for the zero time.
func timeValue(t *metav1.Time) any {
	if t.IsZero() {
		return nil
	}
	return timeString(t.Time)
}

func timeString(t time.Time) string { return t.UTC().Format(time.RFC3339) }
