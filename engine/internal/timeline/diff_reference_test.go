package timeline

import (
	"fmt"
	"reflect"
	"sort"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/perffixture"
)

// summarizeReference is Summarize as it was before the allocation fix: a
// reflect.DeepEqual at every level. Kept to pin the fast walk to exactly the
// same timeline entries.
func summarizeReference(old, nw map[string]any) (fields []FieldChange, more int) {
	var all []FieldChange
	walkReference(&all, "", 0, old, nw)
	if len(all) > maxDiffFields {
		return all[:maxDiffFields], len(all) - maxDiffFields
	}
	return all, 0
}

func walkReference(out *[]FieldChange, path string, depth int, a, b any) {
	if reflect.DeepEqual(a, b) {
		return
	}
	am, aok := a.(map[string]any)
	bm, bok := b.(map[string]any)
	if (a == nil || aok) && (b == nil || bok) && (aok || bok) && depth < maxDiffDepth {
		keys := map[string]bool{}
		for k := range am {
			keys[k] = true
		}
		for k := range bm {
			keys[k] = true
		}
		sorted := make([]string, 0, len(keys))
		for k := range keys {
			sorted = append(sorted, k)
		}
		sort.Strings(sorted)
		for _, k := range sorted {
			p := joinPath(path, k)
			if ignored(p, k) {
				continue
			}
			av, ain := am[k]
			bv, bin := bm[k]
			switch {
			case (p == "metadata.labels" || p == "metadata.annotations") && (!ain || !bin):
				walkReference(out, p, depth+1, av, bv)
			case !ain:
				*out = append(*out, FieldChange{p, "added"})
			case !bin:
				*out = append(*out, FieldChange{p, "removed"})
			default:
				walkReference(out, p, depth+1, av, bv)
			}
		}
		return
	}
	al, aok := a.([]any)
	bl, bok := b.([]any)
	if aok && bok && depth < maxDiffDepth {
		for i := 0; i < max(len(al), len(bl)); i++ {
			p := path + "[" + itoa(i) + "]"
			switch {
			case i >= len(al):
				*out = append(*out, FieldChange{p, "added"})
			case i >= len(bl):
				*out = append(*out, FieldChange{p, "removed"})
			default:
				walkReference(out, p, depth+1, al[i], bl[i])
			}
		}
		return
	}
	if path == "" {
		return
	}
	*out = append(*out, FieldChange{path, "changed"})
}

// mutations covers what the fast walk must treat exactly as before: scalar
// and type changes, added and removed keys and list items, labels appearing
// and vanishing, nil versus empty containers, values below the depth cut,
// ignored bookkeeping, and Go types a typed object converts to (int, int32).
var mutations = []func(p map[string]any){
	func(p map[string]any) {},
	func(p map[string]any) { p["spec"].(map[string]any)["restartPolicy"] = "Never" },
	func(p map[string]any) { p["spec"].(map[string]any)["priority"] = float64(0) },
	func(p map[string]any) { p["spec"].(map[string]any)["priority"] = 0 },
	func(p map[string]any) { p["spec"].(map[string]any)["priority"] = int32(0) },
	func(p map[string]any) { p["spec"].(map[string]any)["newField"] = map[string]any{"a": int64(1)} },
	func(p map[string]any) { delete(p["spec"].(map[string]any), "dnsPolicy") },
	func(p map[string]any) { delete(p["metadata"].(map[string]any), "labels") },
	func(p map[string]any) { p["metadata"].(map[string]any)["labels"].(map[string]any)["x"] = "y" },
	func(p map[string]any) { p["metadata"].(map[string]any)["annotations"] = nil },
	func(p map[string]any) { p["metadata"].(map[string]any)["finalizers"] = []any{"a", "b"} },
	func(p map[string]any) { p["metadata"].(map[string]any)["resourceVersion"] = "9" },
	func(p map[string]any) { p["metadata"].(map[string]any)["managedFields"] = []any{} },
	func(p map[string]any) { p["status"].(map[string]any)["lastState"] = map[string]any(nil) },
	func(p map[string]any) { p["status"].(map[string]any)["podIPs"] = []any(nil) },
	func(p map[string]any) { p["status"].(map[string]any)["podIPs"] = []any{} },
	func(p map[string]any) { p["status"].(map[string]any)["podIPs"] = "flat" },
	func(p map[string]any) {
		cs := p["status"].(map[string]any)["containerStatuses"].([]any)
		p["status"].(map[string]any)["containerStatuses"] = append(cs, map[string]any{"name": "x"})
	},
	func(p map[string]any) {
		cs := p["status"].(map[string]any)["containerStatuses"].([]any)
		p["status"].(map[string]any)["containerStatuses"] = cs[:1]
	},
	func(p map[string]any) {
		// below the depth cut: one change for the whole subtree
		v := p["spec"].(map[string]any)["volumes"].([]any)[3].(map[string]any)["projected"].(map[string]any)
		v["sources"].([]any)[1].(map[string]any)["configMap"].(map[string]any)["name"] = "other"
	},
	func(p map[string]any) {
		p["status"].(map[string]any)["conditions"].([]any)[0].(map[string]any)["lastProbeTime"] = "2026-11-01T11:00:00Z"
	},
	func(p map[string]any) {
		p["status"].(map[string]any)["conditions"].([]any)[0].(map[string]any)["status"] = "False"
	},
	func(p map[string]any) {
		e := p["spec"].(map[string]any)["containers"].([]any)[0].(map[string]any)["env"].([]any)
		e[3].(map[string]any)["value"] = "changed"
	},
}

func TestSummarizeMatchesReference(t *testing.T) {
	for i := 0; i < 200; i++ {
		p := perffixture.Pod(i)
		for j, mut := range mutations {
			q := perffixture.Churn(p, i+j+1)
			mut(q)
			for _, pair := range [][2]map[string]any{{p, q}, {q, p}, {nil, q}, {p, nil}} {
				a, am := Summarize(pair[0], pair[1])
				b, bm := summarizeReference(pair[0], pair[1])
				if !reflect.DeepEqual(a, b) || am != bm {
					t.Fatalf("pod %d mutation %d: got %v/%d, want %v/%d", i, j, a, am, b, bm)
				}
			}
		}
	}
	// many fields: the 50-field cut lands in the same place
	wide, wider := map[string]any{}, map[string]any{}
	for k := 0; k < 120; k++ {
		wide[fmt.Sprintf("f%03d", k)] = int64(k)
		wider[fmt.Sprintf("f%03d", k)] = int64(k + 1)
	}
	a, am := Summarize(map[string]any{"spec": wide}, map[string]any{"spec": wider})
	b, bm := summarizeReference(map[string]any{"spec": wide}, map[string]any{"spec": wider})
	if !reflect.DeepEqual(a, b) || am != bm || am != 70 {
		t.Fatalf("wide: got %d fields +%d, want %d +%d", len(a), am, len(b), bm)
	}
}

// One kubelet status write on one pod (resourceVersion, kubelet's
// managedFields time, a condition's time, a restart) used to cost 1,081
// allocations and 81.6 KB in reflect.DeepEqual; the fast walk does 7.
// The ceilings leave room and do not depend on timing.
func TestSummarizeAllocationBudget(t *testing.T) {
	p := perffixture.Pod(7)
	q := perffixture.Churn(p, 8) // n%4==0: restartCount and ready change too
	if fc, _ := Summarize(p, q); len(fc) == 0 {
		t.Fatal("churn should summarise to some fields")
	}
	if n := testing.AllocsPerRun(100, func() { Summarize(p, q) }); n > 30 {
		t.Errorf("Summarize on a pod status write: %.0f allocs, budget 30 (was 1,081)", n)
	}
	hb := perffixture.DeepCopy(p)
	md := hb["metadata"].(map[string]any)
	md["resourceVersion"] = "1001"
	md["managedFields"].([]any)[2].(map[string]any)["time"] = "2026-11-01T10:05:00Z"
	if n := testing.AllocsPerRun(100, func() { Summarize(p, hb) }); n > 10 {
		t.Errorf("Summarize on a heartbeat-only write: %.0f allocs, budget 10 (was 1,005)", n)
	}
}
