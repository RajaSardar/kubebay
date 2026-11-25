package timeline

import (
	"reflect"
	"sort"
	"strings"
	"time"
)

const (
	maxDiffDepth  = 6  // path segments walked before a subtree counts as one change
	maxDiffFields = 50 // changed paths kept per change; the rest are counted
)

// Summarize lists the paths that differ between two objects, never their
// values. Bookkeeping that changes on every write (resourceVersion,
// generation, managedFields, observedGeneration, condition heartbeat times)
// is left out, so a heartbeat-only update summarises to nothing and the
// caller drops it as noise. Label and annotation keys are named; their values
// are not. Either side nil means the object was added or deleted.
func Summarize(old, nw map[string]any) (fields []FieldChange, more int) {
	var all []FieldChange
	walk(&all, "", 0, old, nw)
	if len(all) > maxDiffFields {
		return all[:maxDiffFields], len(all) - maxDiffFields
	}
	return all, 0
}

var bookkeeping = map[string]bool{
	"metadata.resourceVersion":            true,
	"metadata.generation":                 true,
	"metadata.managedFields":              true,
	"status.observedGeneration":           true,
	"metadata.creationTimestamp":          true,
	"metadata.selfLink":                   true,
	"metadata.deletionGracePeriodSeconds": true,
}

var heartbeatKeys = map[string]bool{"lastHeartbeatTime": true, "lastTransitionTime": true, "lastUpdateTime": true, "lastProbeTime": true}

func ignored(path, key string) bool {
	return bookkeeping[path] || heartbeatKeys[key] && strings.Contains(path, ".conditions[")
}

func joinPath(prefix, key string) string {
	switch prefix {
	case "":
		return key
	case "metadata.labels", "metadata.annotations":
		return prefix + "[" + key + "]"
	}
	return prefix + "." + key
}

// walk descends only where a and b differ. Equal children are skipped with
// jsonEqual before their path is built, so a write that touches one leaf
// compares each value once and allocates almost nothing. (It used to
// reflect.DeepEqual every subtree before descending: about 1,000 allocations
// and 80 KB per pod update.)
func walk(out *[]FieldChange, path string, depth int, a, b any) {
	am, aok := a.(map[string]any)
	bm, bok := b.(map[string]any)
	if (a == nil || aok) && (b == nil || bok) && (aok || bok) && depth < maxDiffDepth {
		var differ []string
		for k, av := range am {
			if bv, in := bm[k]; !in || !jsonEqual(av, bv) {
				differ = append(differ, k)
			}
		}
		for k := range bm {
			if _, in := am[k]; !in {
				differ = append(differ, k)
			}
		}
		sort.Strings(differ)
		for _, k := range differ {
			p := joinPath(path, k)
			if ignored(p, k) {
				continue
			}
			av, ain := am[k]
			bv, bin := bm[k]
			switch {
			case (p == "metadata.labels" || p == "metadata.annotations") && (!ain || !bin):
				// Name the keys, not just that the map appeared.
				walk(out, p, depth+1, av, bv)
			case !ain:
				*out = append(*out, FieldChange{p, "added"})
			case !bin:
				*out = append(*out, FieldChange{p, "removed"})
			default:
				walk(out, p, depth+1, av, bv)
			}
		}
		return
	}
	al, aok := a.([]any)
	bl, bok := b.([]any)
	if aok && bok && depth < maxDiffDepth {
		for i := 0; i < max(len(al), len(bl)); i++ {
			switch {
			case i >= len(al):
				*out = append(*out, FieldChange{path + "[" + itoa(i) + "]", "added"})
			case i >= len(bl):
				*out = append(*out, FieldChange{path + "[" + itoa(i) + "]", "removed"})
			case !jsonEqual(al[i], bl[i]):
				walk(out, path+"["+itoa(i)+"]", depth+1, al[i], bl[i])
			}
		}
		return
	}
	if path == "" || jsonEqual(a, b) {
		return
	}
	*out = append(*out, FieldChange{path, "changed"})
}

// jsonEqual is reflect.DeepEqual for the shapes an unstructured object holds
// (maps, slices, strings, int64, float64, bool, nil) without reflection; any
// other type falls back to reflect.DeepEqual. A nil and an empty container
// compare equal here, which changes nothing: walk lists no paths for them.
func jsonEqual(a, b any) bool {
	switch x := a.(type) {
	case nil:
		return b == nil
	case string:
		y, ok := b.(string)
		return ok && x == y
	case bool:
		y, ok := b.(bool)
		return ok && x == y
	case int64:
		y, ok := b.(int64)
		return ok && x == y
	case float64:
		y, ok := b.(float64)
		return ok && x == y
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for k, v := range x {
			w, in := y[k]
			if !in || !jsonEqual(v, w) {
				return false
			}
		}
		return true
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i := range x {
			if !jsonEqual(x[i], y[i]) {
				return false
			}
		}
		return true
	}
	return reflect.DeepEqual(a, b)
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for ; i > 0; i /= 10 {
		b = append([]byte{byte('0' + i%10)}, b...)
	}
	return string(b)
}

// Denied reports kinds that are never recorded: Secrets (any group, whatever
// the cache holds), and the objects that change every few seconds without
// meaning anything (Leases, Endpoints, EndpointSlices, events.k8s.io copies).
func Denied(group, resource, kind string) bool {
	switch {
	case resource == "secrets" || kind == "Secret":
		return true
	case group == "coordination.k8s.io" && (resource == "leases" || kind == "Lease"):
		return true
	case group == "discovery.k8s.io" && (resource == "endpointslices" || kind == "EndpointSlice"):
		return true
	case group == "" && (resource == "endpoints" || kind == "Endpoints"):
		return true
	case group == "events.k8s.io":
		return true
	}
	return false
}

type writer struct {
	key  string
	mgr  string
	time time.Time
}

func writers(o map[string]any) []writer {
	md, _ := o["metadata"].(map[string]any)
	list, _ := md["managedFields"].([]any)
	var out []writer
	for _, e := range list {
		em, _ := e.(map[string]any)
		mgr, _ := em["manager"].(string)
		op, _ := em["operation"].(string)
		ts, _ := em["time"].(string)
		t, err := time.Parse(time.RFC3339, ts)
		if mgr == "" || err != nil {
			continue
		}
		out = append(out, writer{mgr + "|" + op + "|" + ts, mgr, t})
	}
	return out
}

// ManagerOf names who made a change: the managedFields entry that is new or
// newer than any the old object had. Nothing newer means nobody wrote since,
// so the manager is unknown rather than a stale one. old may be nil.
// managedFields carries a manager and a time per entry, not the fields.
func ManagerOf(old, nw map[string]any) (string, *time.Time) {
	seen := map[string]bool{}
	for _, w := range writers(old) {
		seen[w.key] = true
	}
	var best *writer
	for _, w := range writers(nw) {
		if seen[w.key] {
			continue
		}
		if best == nil || !w.time.Before(best.time) {
			w := w
			best = &w
		}
	}
	if best == nil {
		return "", nil
	}
	t := best.time.UTC()
	return best.mgr, &t
}

var knownKinds = map[string]string{
	"pods": "Pod", "deployments": "Deployment", "replicasets": "ReplicaSet", "statefulsets": "StatefulSet",
	"daemonsets": "DaemonSet", "jobs": "Job", "cronjobs": "CronJob", "services": "Service", "ingresses": "Ingress",
	"ingressclasses": "IngressClass", "configmaps": "ConfigMap", "persistentvolumeclaims": "PersistentVolumeClaim",
	"persistentvolumes": "PersistentVolume", "nodes": "Node", "namespaces": "Namespace", "serviceaccounts": "ServiceAccount",
	"roles": "Role", "rolebindings": "RoleBinding", "clusterroles": "ClusterRole", "clusterrolebindings": "ClusterRoleBinding",
	"networkpolicies": "NetworkPolicy", "horizontalpodautoscalers": "HorizontalPodAutoscaler",
	"poddisruptionbudgets": "PodDisruptionBudget", "storageclasses": "StorageClass", "events": "Event",
	"resourcequotas": "ResourceQuota", "limitranges": "LimitRange", "customresourcedefinitions": "CustomResourceDefinition",
	"replicationcontrollers": "ReplicationController", "priorityclasses": "PriorityClass", "volumeattachments": "VolumeAttachment",
}

// KindFor is the Kind of an object seen through a watch on resource. A
// metadata-only watch reports every object as PartialObjectMetadata, so the
// Kind then comes from the resource name: a table for the built-ins, a
// singular-and-capitalise guess for the rest.
func KindFor(resource, objKind string) string {
	if objKind != "" && objKind != "PartialObjectMetadata" {
		return objKind
	}
	if k, ok := knownKinds[resource]; ok {
		return k
	}
	s := resource
	switch {
	case strings.HasSuffix(s, "ies"):
		s = s[:len(s)-3] + "y"
	case strings.HasSuffix(s, "sses"), strings.HasSuffix(s, "xes"), strings.HasSuffix(s, "ches"), strings.HasSuffix(s, "shes"), strings.HasSuffix(s, "zes"):
		s = s[:len(s)-2]
	case strings.HasSuffix(s, "s"):
		s = s[:len(s)-1]
	}
	if s == "" {
		return ""
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
