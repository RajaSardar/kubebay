package httpapi

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/types"
)

const deployYAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: debugging-apis-fml-in
  namespace: debug
  annotations:
    meta.helm.sh/release-name: api-consumers-in
    kubectl.kubernetes.io/last-applied-configuration: '{"x":1}'
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: debugging-apis
        image: repo/debugging-apis:1.4
        env:
        - name: CONFIG_USER
          value: old-user
        - name: CONFIG_USER_PWD
          value: old-pwd
        - name: REGION
          value: eu-west-1
        - name: KEEP
          value: same
status:
  replicas: 2
`

func edit(s string, pairs ...string) string {
	for i := 0; i+1 < len(pairs); i += 2 {
		if !strings.Contains(s, pairs[i]) {
			panic("fixture missing " + pairs[i])
		}
		s = strings.Replace(s, pairs[i], pairs[i+1], 1)
	}
	return s
}

func decode(t *testing.T, b []byte) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("patch is not JSON: %v (%s)", err, b)
	}
	return m
}

func TestEditPatchChangesOnlyTheEditedEnvValues(t *testing.T) {
	edited := edit(deployYAML, "value: old-user", "value: new-user", "value: old-pwd", "value: new-pwd", "value: eu-west-1", "value: us-east-1")
	p, err := computeEditPatch([]byte(deployYAML), []byte(edited))
	if err != nil {
		t.Fatal(err)
	}
	if p.Type != types.StrategicMergePatchType {
		t.Fatalf("type = %s, want strategic merge patch for a built-in kind", p.Type)
	}
	want := []string{
		"spec.template.spec.containers[name=debugging-apis].env[name=CONFIG_USER].value",
		"spec.template.spec.containers[name=debugging-apis].env[name=CONFIG_USER_PWD].value",
		"spec.template.spec.containers[name=debugging-apis].env[name=REGION].value",
	}
	if !reflect.DeepEqual(p.ChangedPaths, want) {
		t.Errorf("changed paths = %v, want %v", p.ChangedPaths, want)
	}
	// $setElementOrder directives only pin list order; they change no values.
	body := string(withoutDirectives(t, p.Data))
	for _, unwanted := range []string{"image", "replicas", "KEEP", "status", "last-applied", "helm"} {
		if strings.Contains(body, unwanted) {
			t.Errorf("patch touches %q, which the user did not edit: %s", unwanted, body)
		}
	}
}

func withoutDirectives(t *testing.T, data []byte) []byte {
	t.Helper()
	var strip func(v interface{}) interface{}
	strip = func(v interface{}) interface{} {
		switch x := v.(type) {
		case map[string]interface{}:
			out := map[string]interface{}{}
			for k, vv := range x {
				if !strings.HasPrefix(k, "$setElementOrder") {
					out[k] = strip(vv)
				}
			}
			return out
		case []interface{}:
			for i := range x {
				x[i] = strip(x[i])
			}
			return x
		}
		return v
	}
	b, _ := json.Marshal(strip(decode(t, data)))
	return b
}

func TestEditPatchDeletesARemovedEnvVar(t *testing.T) {
	edited := edit(deployYAML, "        - name: KEEP\n          value: same\n", "")
	p, err := computeEditPatch([]byte(deployYAML), []byte(edited))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(p.Data), `"$patch":"delete"`) || !strings.Contains(string(p.Data), `"KEEP"`) {
		t.Errorf("removing an env var must send a delete directive, got %s", p.Data)
	}
	if !reflect.DeepEqual(p.ChangedPaths, []string{"spec.template.spec.containers[name=debugging-apis].env[name=KEEP] (removed)"}) {
		t.Errorf("changed paths = %v", p.ChangedPaths)
	}
}

func TestEditPatchIgnoresStatusAndServerFields(t *testing.T) {
	edited := edit(deployYAML, "status:\n  replicas: 2", "status:\n  replicas: 9", `'{"x":1}'`, `'{"x":2}'`)
	p, err := computeEditPatch([]byte(deployYAML), []byte(edited))
	if err != nil {
		t.Fatal(err)
	}
	if !p.Empty() {
		t.Errorf("status and last-applied edits must not be patched, got %s", p.Data)
	}
}

func TestEditPatchNoChangeIsEmpty(t *testing.T) {
	p, err := computeEditPatch([]byte(deployYAML), []byte(deployYAML))
	if err != nil {
		t.Fatal(err)
	}
	if !p.Empty() || len(p.ChangedPaths) != 0 {
		t.Errorf("unchanged YAML should give an empty patch, got %s %v", p.Data, p.ChangedPaths)
	}
}

func TestEditPatchRejectsIdentityChanges(t *testing.T) {
	for _, e := range [][2]string{
		{"name: debugging-apis-fml-in", "name: other"},
		{"namespace: debug", "namespace: prod"},
		{"kind: Deployment", "kind: StatefulSet"},
		{"apiVersion: apps/v1", "apiVersion: apps/v1beta2"},
	} {
		if _, err := computeEditPatch([]byte(deployYAML), []byte(edit(deployYAML, e[0], e[1]))); err == nil {
			t.Errorf("changing %q should be rejected", e[0])
		}
	}
}

const crdYAML = `apiVersion: example.com/v1
kind: Widget
metadata:
  name: w1
  namespace: default
spec:
  size: 1
  tags:
  - a
  - b
`

func TestEditPatchUsesJSONMergePatchForCustomResources(t *testing.T) {
	edited := edit(crdYAML, "size: 1", "size: 3", "  - b\n", "")
	p, err := computeEditPatch([]byte(crdYAML), []byte(edited))
	if err != nil {
		t.Fatal(err)
	}
	if p.Type != types.MergePatchType {
		t.Fatalf("type = %s, want JSON merge patch for a custom resource", p.Type)
	}
	got := decode(t, p.Data)
	want := map[string]interface{}{"spec": map[string]interface{}{"size": float64(3), "tags": []interface{}{"a"}}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("patch = %v, want %v", got, want)
	}
	if !reflect.DeepEqual(p.ChangedPaths, []string{"spec.size", "spec.tags"}) {
		t.Errorf("changed paths = %v", p.ChangedPaths)
	}
}

func TestEditPatchRemovedMapKeyBecomesNullInMergePatch(t *testing.T) {
	edited := edit(crdYAML, "  size: 1\n", "")
	p, err := computeEditPatch([]byte(crdYAML), []byte(edited))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(p.Data), `"size":null`) {
		t.Errorf("a removed field must be nulled in a merge patch: %s", p.Data)
	}
}
