package httpapi

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	jsonpatch "github.com/evanphx/json-patch"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/strategicpatch"
	"k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/yaml"
)

// EditPatch is what an edit in the YAML tab becomes: only the fields the
// user changed, sent as an Update patch (what `kubectl edit` and
// `kubectl patch` do). An Update never conflicts with other field managers
// and only takes ownership of fields whose values actually change, so a
// Helm- or kubectl-managed object can be edited without forcing ownership
// of anything else. Server-side apply of the whole object, which the tab
// used before, failed whenever any field it re-sent was owned by someone else.
type EditPatch struct {
	Type types.PatchType
	Data []byte
	// ChangedPaths names the edited fields, for the audit log and the UI.
	// It never carries values: an edited field may be a password.
	ChangedPaths []string
}

func (p EditPatch) Empty() bool { return string(p.Data) == "{}" || len(p.Data) == 0 }

const lastAppliedAnnotation = "kubectl.kubernetes.io/last-applied-configuration"

// normalizeForEdit drops what an edit must never send: status (a separate
// subresource), server-managed metadata, and kubectl's last-applied
// annotation (kubectl's three-way merge state, not user intent).
func normalizeForEdit(doc map[string]interface{}) {
	delete(doc, "status")
	meta, _ := doc["metadata"].(map[string]interface{})
	if meta == nil {
		return
	}
	for _, k := range []string{"managedFields", "resourceVersion", "uid", "selfLink", "generation", "creationTimestamp"} {
		delete(meta, k)
	}
	if ann, ok := meta["annotations"].(map[string]interface{}); ok {
		delete(ann, lastAppliedAnnotation)
	}
}

func identity(doc map[string]interface{}) [4]string {
	meta, _ := doc["metadata"].(map[string]interface{})
	s := func(m map[string]interface{}, k string) string { v, _ := m[k].(string); return v }
	return [4]string{s(doc, "apiVersion"), s(doc, "kind"), s(meta, "name"), s(meta, "namespace")}
}

// computeEditPatch diffs the YAML the user loaded against what they edited.
// Built-in kinds get a strategic merge patch (list items merge by key, so a
// removed env var becomes a delete directive); custom resources get an
// RFC 7386 JSON merge patch, since the API server rejects strategic merge
// patches for them.
func computeEditPatch(originalYAML, editedYAML []byte) (EditPatch, error) {
	var orig, edited map[string]interface{}
	if err := yaml.Unmarshal(originalYAML, &orig); err != nil {
		return EditPatch{}, fmt.Errorf("original YAML: %w", err)
	}
	if err := yaml.Unmarshal(editedYAML, &edited); err != nil {
		return EditPatch{}, fmt.Errorf("invalid YAML: %w", err)
	}
	if orig == nil || edited == nil {
		return EditPatch{}, fmt.Errorf("empty document")
	}
	if a, b := identity(orig), identity(edited); a != b {
		return EditPatch{}, fmt.Errorf("apiVersion, kind, name and namespace can't be changed in an edit (was %s %s %s/%s)", a[0], a[1], a[3], a[2])
	}
	normalizeForEdit(orig)
	normalizeForEdit(edited)
	origJSON, err := json.Marshal(orig)
	if err != nil {
		return EditPatch{}, err
	}
	editedJSON, err := json.Marshal(edited)
	if err != nil {
		return EditPatch{}, err
	}

	id := identity(orig)
	gvk := schema.FromAPIVersionAndKind(id[0], id[1])
	var p EditPatch
	if typed, err := scheme.Scheme.New(gvk); err == nil {
		data, err := strategicpatch.CreateTwoWayMergePatch(origJSON, editedJSON, typed)
		if err != nil {
			return EditPatch{}, fmt.Errorf("compute patch: %w", err)
		}
		p = EditPatch{Type: types.StrategicMergePatchType, Data: data}
	} else {
		data, err := jsonpatch.CreateMergePatch(origJSON, editedJSON)
		if err != nil {
			return EditPatch{}, fmt.Errorf("compute patch: %w", err)
		}
		p = EditPatch{Type: types.MergePatchType, Data: data}
	}
	var tree map[string]interface{}
	if err := json.Unmarshal(p.Data, &tree); err != nil {
		return EditPatch{}, err
	}
	paths := []string{}
	collectPatchPaths(tree, "", p.Type == types.StrategicMergePatchType, &paths)
	sort.Strings(paths)
	p.ChangedPaths = paths
	return p, nil
}

// List-item identity keys, in the order strategic merge patch uses them.
var mergeKeys = []string{"name", "mountPath", "containerPort", "devicePath", "ip", "type", "key"}

func listItemKey(item map[string]interface{}) (string, bool) {
	for _, k := range mergeKeys {
		if v, ok := item[k]; ok {
			return fmt.Sprintf("%s=%v", k, v), true
		}
	}
	return "", false
}

func collectPatchPaths(node map[string]interface{}, prefix string, strategic bool, out *[]string) {
	join := func(k string) string {
		if prefix == "" {
			return k
		}
		return prefix + "." + k
	}
	for k, v := range node {
		if strings.HasPrefix(k, "$") {
			continue // $setElementOrder, $retainKeys, $patch: directives, not edits
		}
		switch val := v.(type) {
		case map[string]interface{}:
			collectPatchPaths(val, join(k), strategic, out)
		case []interface{}:
			if !strategic || len(val) == 0 {
				*out = append(*out, join(k))
				continue
			}
			for i, it := range val {
				item, ok := it.(map[string]interface{})
				if !ok {
					*out = append(*out, join(k)) // list of scalars: replaced whole
					break
				}
				keyStr, hasKey := listItemKey(item)
				if !hasKey {
					keyStr = fmt.Sprint(i)
				}
				itemPath := fmt.Sprintf("%s[%s]", join(k), keyStr)
				if item["$patch"] == "delete" {
					*out = append(*out, itemPath+" (removed)")
					continue
				}
				rest := map[string]interface{}{}
				for ik, iv := range item {
					if hasKey && fmt.Sprintf("%s=%v", ik, iv) == keyStr {
						continue
					}
					rest[ik] = iv
				}
				if len(rest) == 0 {
					*out = append(*out, itemPath)
					continue
				}
				collectPatchPaths(rest, itemPath, strategic, out)
			}
		default:
			*out = append(*out, join(k))
		}
	}
}
