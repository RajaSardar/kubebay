package extensions

import (
	"os"
	"regexp"
	"testing"
)

// The examples in docs/EXTENSIONS.md are what people copy, so each must load
// cleanly.
func TestDocsExamplesLoad(t *testing.T) {
	doc, err := os.ReadFile("../../../docs/EXTENSIONS.md")
	if err != nil {
		t.Fatal(err)
	}
	blocks := regexp.MustCompile("(?s)```yaml\n(.*?)```").FindAllSubmatch(doc, -1)
	if len(blocks) < 3 {
		t.Fatalf("found %d yaml examples, want the Grafana, stern and Rancher ones at least", len(blocks))
	}
	var actions int
	for i, b := range blocks {
		f := Parse(b[1])
		if len(f.Errors) != 0 {
			t.Errorf("example %d: %q\n%s", i+1, f.Errors, b[1])
		}
		if len(f.Columns)+len(f.Actions) == 0 {
			t.Errorf("example %d loads nothing:\n%s", i+1, b[1])
		}
		actions += len(f.Actions)
	}
	if actions < 3 {
		t.Errorf("%d actions across the examples", actions)
	}
}
