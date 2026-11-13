package searchindex

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// parity.json is generated from the TypeScript ranker the palette runs for the
// kinds the app follows (web/apps/shell/src/lib/paletteSearch.ts). The Go ranker
// here serves the rest, so the two must rank the same objects the same way.
type parityFile struct {
	Objects []struct{ Slug, NS, Name string } `json:"objects"`
	Parse   []struct {
		Q     string   `json:"q"`
		Slug  string   `json:"slug"`
		Terms []string `json:"terms"`
	} `json:"parse"`
	Search []struct {
		Q      string `json:"q"`
		Groups []struct {
			Slug  string `json:"slug"`
			Total int    `json:"total"`
			Hits  []struct {
				NS    string `json:"ns"`
				Name  string `json:"name"`
				Score int    `json:"score"`
			} `json:"hits"`
		} `json:"groups"`
	} `json:"search"`
}

func loadParity(t *testing.T) parityFile {
	t.Helper()
	b, err := os.ReadFile("testdata/parity.json")
	if err != nil {
		t.Fatal(err)
	}
	var p parityFile
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

// The kind words the palette itself understands, as in paletteSearch.ts.
var parityAliases = map[string]string{
	"pod": "pods", "pods": "pods", "po": "pods",
	"deployment": "deployments", "deployments": "deployments", "deploy": "deployments", "dep": "deployments",
	"statefulset": "statefulsets", "statefulsets": "statefulsets", "sts": "statefulsets",
	"daemonset": "daemonsets", "daemonsets": "daemonsets", "ds": "daemonsets",
	"job": "jobs", "jobs": "jobs",
	"node": "nodes", "nodes": "nodes", "no": "nodes",
	"namespace": "namespaces", "namespaces": "namespaces", "ns": "namespaces",
}

func TestParseQueryMatchesTheTypeScriptParser(t *testing.T) {
	for _, c := range loadParity(t).Parse {
		slug, terms := ParseQuery(c.Q, parityAliases)
		want := c.Terms
		if want == nil {
			want = []string{}
		}
		if terms == nil {
			terms = []string{}
		}
		if slug != c.Slug || !reflect.DeepEqual(terms, want) {
			t.Errorf("ParseQuery(%q) = %q, %v; want %q, %v", c.Q, slug, terms, c.Slug, want)
		}
	}
}

func TestSearchMatchesTheTypeScriptRanker(t *testing.T) {
	p := loadParity(t)
	for _, c := range p.Search {
		ix := newForTest(parityAliases)
		for _, o := range p.Objects {
			ix.putForTest(o.Slug, o.NS, o.Name)
		}
		res := ix.Search(c.Q, SearchOptions{PerGroup: 3, MaxGroups: 7})
		if len(res.Groups) != len(c.Groups) {
			t.Errorf("%q: %d groups %v, want %d", c.Q, len(res.Groups), groupSlugs(res.Groups), len(c.Groups))
			continue
		}
		for i, g := range res.Groups {
			w := c.Groups[i]
			if g.Slug != w.Slug || g.Total != w.Total || len(g.Hits) != len(w.Hits) {
				t.Errorf("%q group %d: got %s total %d hits %d, want %s total %d hits %d", c.Q, i, g.Slug, g.Total, len(g.Hits), w.Slug, w.Total, len(w.Hits))
				continue
			}
			for j, h := range g.Hits {
				if h.NS != w.Hits[j].NS || h.Name != w.Hits[j].Name || h.Score != w.Hits[j].Score {
					t.Errorf("%q %s hit %d: got %+v, want %+v", c.Q, g.Slug, j, h, w.Hits[j])
				}
			}
		}
	}
}

func groupSlugs(gs []Group) []string {
	out := make([]string, len(gs))
	for i, g := range gs {
		out[i] = g.Slug
	}
	return out
}
