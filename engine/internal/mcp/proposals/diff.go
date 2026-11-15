package proposals

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"

	"sigs.k8s.io/yaml"
)

// clean drops what changes on every write or isn't the user's intent:
// status, managedFields, versions, ids and the last-applied copy.
func clean(o map[string]any) map[string]any {
	b, _ := json.Marshal(o)
	var c map[string]any
	_ = json.Unmarshal(b, &c)
	delete(c, "status")
	if m, ok := c["metadata"].(map[string]any); ok {
		for _, k := range []string{"managedFields", "resourceVersion", "generation", "uid", "creationTimestamp", "selfLink"} {
			delete(m, k)
		}
		if ann, ok := m["annotations"].(map[string]any); ok {
			delete(ann, "kubectl.kubernetes.io/last-applied-configuration")
			delete(ann, "deployment.kubernetes.io/revision")
			if len(ann) == 0 {
				delete(m, "annotations")
			}
		}
	}
	return c
}

// redactEnv replaces every literal env value with <redacted>, wherever a
// container list appears, so the assistant's copy of the diff matches what
// MCP's read tools show.
func redactEnv(v any) map[string]any {
	b, _ := json.Marshal(v)
	var c map[string]any
	_ = json.Unmarshal(b, &c)
	var walk func(any)
	walk = func(n any) {
		switch t := n.(type) {
		case map[string]any:
			for k, child := range t {
				if k == "env" {
					if list, ok := child.([]any); ok {
						for _, e := range list {
							if em, ok := e.(map[string]any); ok {
								if _, has := em["value"]; has {
									em["value"] = "<redacted>"
								}
							}
						}
						continue
					}
				}
				walk(child)
			}
		case []any:
			for _, child := range t {
				walk(child)
			}
		}
	}
	walk(c)
	return c
}

func toYAML(o map[string]any) string {
	b, err := yaml.Marshal(o)
	if err != nil {
		return fmt.Sprint(o)
	}
	return string(b)
}

// changedPaths lists the dotted paths whose values differ. Lists count as
// one value.
func changedPaths(a, b map[string]any) []string {
	var out []string
	var walk func(prefix string, x, y map[string]any)
	walk = func(prefix string, x, y map[string]any) {
		keys := map[string]bool{}
		for k := range x {
			keys[k] = true
		}
		for k := range y {
			keys[k] = true
		}
		for k := range keys {
			p := k
			if prefix != "" {
				p = prefix + "." + k
			}
			xm, xok := x[k].(map[string]any)
			ym, yok := y[k].(map[string]any)
			if xok && yok {
				walk(p, xm, ym)
				continue
			}
			if !reflect.DeepEqual(x[k], y[k]) {
				out = append(out, p)
			}
		}
	}
	walk("", a, b)
	sort.Strings(out)
	return out
}

const (
	diffContext  = 3
	maxDiffLines = 4000
)

// lineDiff is a unified-style diff of two texts: "-" removed, "+" added,
// three lines of context, "…" between hunks.
func lineDiff(a, b string) string {
	x := strings.Split(strings.TrimRight(a, "\n"), "\n")
	y := strings.Split(strings.TrimRight(b, "\n"), "\n")
	if len(x) > maxDiffLines || len(y) > maxDiffLines {
		return "(too large to diff line by line)"
	}
	// Longest common subsequence table, from the end.
	lcs := make([][]int, len(x)+1)
	for i := range lcs {
		lcs[i] = make([]int, len(y)+1)
	}
	for i := len(x) - 1; i >= 0; i-- {
		for j := len(y) - 1; j >= 0; j-- {
			if x[i] == y[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
			} else if lcs[i+1][j] >= lcs[i][j+1] {
				lcs[i][j] = lcs[i+1][j]
			} else {
				lcs[i][j] = lcs[i][j+1]
			}
		}
	}
	type line struct {
		op   byte
		text string
	}
	var ops []line
	i, j := 0, 0
	for i < len(x) && j < len(y) {
		switch {
		case x[i] == y[j]:
			ops = append(ops, line{' ', x[i]})
			i, j = i+1, j+1
		case lcs[i+1][j] >= lcs[i][j+1]:
			ops = append(ops, line{'-', x[i]})
			i++
		default:
			ops = append(ops, line{'+', y[j]})
			j++
		}
	}
	for ; i < len(x); i++ {
		ops = append(ops, line{'-', x[i]})
	}
	for ; j < len(y); j++ {
		ops = append(ops, line{'+', y[j]})
	}
	keep := make([]bool, len(ops))
	for k, l := range ops {
		if l.op == ' ' {
			continue
		}
		for c := k - diffContext; c <= k+diffContext; c++ {
			if c >= 0 && c < len(ops) {
				keep[c] = true
			}
		}
	}
	var sb strings.Builder
	gap := false
	for k, l := range ops {
		if !keep[k] {
			gap = true
			continue
		}
		if gap && sb.Len() > 0 {
			sb.WriteString("…\n")
		}
		gap = false
		sb.WriteByte(l.op)
		sb.WriteString(l.text)
		sb.WriteByte('\n')
	}
	return sb.String()
}
