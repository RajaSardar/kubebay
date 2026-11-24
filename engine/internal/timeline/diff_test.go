package timeline

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

type m = map[string]any

func obj(rv string, spec, status m, mf ...m) m {
	meta := m{"name": "web", "namespace": "ns", "resourceVersion": rv, "uid": "u1"}
	if len(mf) > 0 {
		var l []any
		for _, e := range mf {
			l = append(l, e)
		}
		meta["managedFields"] = l
	}
	o := m{"apiVersion": "apps/v1", "kind": "Deployment", "metadata": meta}
	if spec != nil {
		o["spec"] = spec
	}
	if status != nil {
		o["status"] = status
	}
	return o
}

func paths(fc []FieldChange) []string {
	var out []string
	for _, f := range fc {
		out = append(out, f.Kind+":"+f.Path)
	}
	return out
}

func TestSummarizeReportsPathsNeverValues(t *testing.T) {
	old := obj("1", m{"replicas": 1, "template": m{"spec": m{"image": "nginx:1"}}}, nil)
	nw := obj("2", m{"replicas": 3, "template": m{"spec": m{"image": "nginx:2", "extra": "supersecret"}}}, nil)
	fc, more := Summarize(old, nw)
	got := strings.Join(paths(fc), ",")
	want := "changed:spec.replicas,added:spec.template.spec.extra,changed:spec.template.spec.image"
	if got != want || more != 0 {
		t.Errorf("got %s want %s", got, want)
	}
	for _, f := range fc {
		if strings.Contains(f.Path+f.Kind, "supersecret") || strings.Contains(f.Path, "nginx") {
			t.Errorf("a value leaked into %+v", f)
		}
	}
}

func TestSummarizeIsStable(t *testing.T) {
	old := obj("1", m{"a": 1, "b": 1, "c": 1}, nil)
	nw := obj("2", m{"a": 2, "b": 2, "c": 2}, nil)
	first, _ := Summarize(old, nw)
	for i := 0; i < 20; i++ {
		again, _ := Summarize(old, nw)
		if !reflect.DeepEqual(first, again) {
			t.Fatal("order changes between runs")
		}
	}
}

func TestSummarizeIgnoresBookkeeping(t *testing.T) {
	old := obj("1", m{"replicas": 1}, m{"observedGeneration": 1, "conditions": []any{m{"type": "Ready", "lastHeartbeatTime": "a", "lastTransitionTime": "a", "status": "True"}}})
	nw := obj("2", m{"replicas": 1}, m{"observedGeneration": 2, "conditions": []any{m{"type": "Ready", "lastHeartbeatTime": "b", "lastTransitionTime": "b", "status": "True"}}})
	nw["metadata"].(m)["generation"] = int64(5)
	fc, _ := Summarize(old, nw)
	if len(fc) != 0 {
		t.Errorf("heartbeat-only change reported: %v", paths(fc))
	}
	nw["status"].(m)["conditions"].([]any)[0].(m)["status"] = "False"
	fc, _ = Summarize(old, nw)
	if len(fc) != 1 || fc[0].Path != "status.conditions[0].status" {
		t.Errorf("a real condition change was lost: %v", paths(fc))
	}
}

func TestSummarizeNamesLabelAndAnnotationKeysOnly(t *testing.T) {
	old := obj("1", nil, nil)
	nw := obj("2", nil, nil)
	nw["metadata"].(m)["labels"] = m{"app": "web"}
	nw["metadata"].(m)["annotations"] = m{"note": "password=hunter2"}
	fc, _ := Summarize(old, nw)
	got := strings.Join(paths(fc), ",")
	if got != "added:metadata.annotations[note],added:metadata.labels[app]" {
		t.Errorf("got %s", got)
	}
	if strings.Contains(got, "hunter2") || strings.Contains(got, "web") {
		t.Error("value leaked")
	}
}

func TestSummarizeCapsDepthAndCount(t *testing.T) {
	deepOld := m{"a": m{"b": m{"c": m{"d": m{"e": m{"f": m{"g": m{"h": 1}}}}}}}}
	deepNew := m{"a": m{"b": m{"c": m{"d": m{"e": m{"f": m{"g": m{"h": 2}}}}}}}}
	fc, _ := Summarize(m{"spec": deepOld}, m{"spec": deepNew})
	if len(fc) != 1 || strings.Count(fc[0].Path, ".") > 6 {
		t.Errorf("depth not capped: %v", paths(fc))
	}
	o, n := m{}, m{}
	for i := 0; i < 80; i++ {
		o[fmt.Sprintf("k%02d", i)] = 1
		n[fmt.Sprintf("k%02d", i)] = 2
	}
	fc, more := Summarize(m{"spec": o}, m{"spec": n})
	if len(fc) != 50 || more != 30 {
		t.Errorf("count cap: %d fields, %d more", len(fc), more)
	}
}

func TestSummarizeArrays(t *testing.T) {
	old := m{"spec": m{"containers": []any{m{"image": "a"}, m{"image": "b"}}}}
	nw := m{"spec": m{"containers": []any{m{"image": "a"}, m{"image": "c"}, m{"image": "d"}}}}
	fc, _ := Summarize(old, nw)
	if got := strings.Join(paths(fc), ","); got != "changed:spec.containers[1].image,added:spec.containers[2]" {
		t.Errorf("got %s", got)
	}
}

func TestDeniedKinds(t *testing.T) {
	for _, c := range []struct{ group, resource, kind string }{
		{"", "secrets", "Secret"}, {"", "secrets", ""}, {"example.com", "secrets", "Secret"},
		{"coordination.k8s.io", "leases", "Lease"}, {"discovery.k8s.io", "endpointslices", "EndpointSlice"},
		{"", "endpoints", "Endpoints"}, {"events.k8s.io", "events", "Event"},
	} {
		if !Denied(c.group, c.resource, c.kind) {
			t.Errorf("%+v is recorded", c)
		}
	}
	for _, c := range []struct{ group, resource, kind string }{{"apps", "deployments", "Deployment"}, {"", "events", "Event"}, {"", "pods", "Pod"}} {
		if Denied(c.group, c.resource, c.kind) {
			t.Errorf("%+v is denied", c)
		}
	}
}

func TestManagerIsTheNewestWriterAtOrAfterTheOldOne(t *testing.T) {
	mf := func(mgr, op, ts string) m { return m{"manager": mgr, "operation": op, "time": ts} }
	old := obj("1", nil, nil, mf("kubectl", "Update", "2026-03-01T10:00:00Z"))
	nw := obj("2", nil, nil, mf("kubectl", "Update", "2026-03-01T10:00:00Z"), mf("argocd", "Apply", "2026-03-01T11:00:00Z"))
	got, at := ManagerOf(old, nw)
	if got != "argocd" || at == nil || at.Hour() != 11 {
		t.Errorf("got %q %v", got, at)
	}
	// Nothing written since: the manager is unknown, not the last stale one.
	same := obj("2", nil, nil, mf("kubectl", "Update", "2026-03-01T10:00:00Z"))
	if got, _ := ManagerOf(old, same); got != "" {
		t.Errorf("stale manager attributed: %q", got)
	}
	if got, _ := ManagerOf(nil, nw); got != "argocd" {
		t.Errorf("an add is attributed to the newest writer, got %q", got)
	}
}

func TestKindFor(t *testing.T) {
	for _, c := range []struct{ resource, objKind, want string }{
		{"pods", "Pod", "Pod"},
		{"pods", "PartialObjectMetadata", "Pod"},
		{"ingresses", "PartialObjectMetadata", "Ingress"},
		{"networkpolicies", "PartialObjectMetadata", "NetworkPolicy"},
		{"widgets", "PartialObjectMetadata", "Widget"},
		{"proxies", "", "Proxy"},
	} {
		if got := KindFor(c.resource, c.objKind); got != c.want {
			t.Errorf("%s/%s = %s want %s", c.resource, c.objKind, got, c.want)
		}
	}
}
