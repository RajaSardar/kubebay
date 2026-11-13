package searchindex

import (
	"sort"
	"strings"
)

// The ranking here mirrors web/apps/shell/src/lib/paletteSearch.ts, which the
// palette runs for the kinds the app already follows. Both are tested against
// testdata/parity.json, so a query ranks the same way wherever it is answered.

// ParseQuery splits a raw query into an optional kind and the words to match.
// A first word that names a kind, then a space or a colon (`svc api`,
// `pod:web`, `ns:`), limits the search to that kind. A lone word stays a term
// until a space says it was a kind.
func ParseQuery(raw string, aliases map[string]string) (slug string, terms []string) {
	lower := strings.ToLower(raw)
	tokens := strings.Fields(lower)
	if len(tokens) == 0 {
		return "", nil
	}
	first := tokens[0]
	if colon := strings.Index(first, ":"); colon > 0 {
		if s, ok := aliases[first[:colon]]; ok {
			rest := first[colon+1:]
			if rest != "" {
				terms = append(terms, rest)
			}
			return s, append(terms, tokens[1:]...)
		}
	} else if s, ok := aliases[first]; ok {
		trailingSpace := len(lower) > 0 && (lower[len(lower)-1] == ' ' || lower[len(lower)-1] == '\t' || lower[len(lower)-1] == '\n')
		if len(tokens) > 1 || trailingSpace {
			return s, tokens[1:]
		}
	}
	return "", tokens
}

func inOrder(hay, needle string) bool {
	j := 0
	for i := 0; i < len(hay) && j < len(needle); i++ {
		if hay[i] == needle[j] {
			j++
		}
	}
	return j == len(needle)
}

// exact name > name prefix > start of a word in the name > anywhere in the
// name > the namespace > the letters in order.
func scoreTerm(e *entry, t string) int {
	if strings.Contains(t, "/") {
		i := strings.Index(e.fullL, t)
		switch {
		case i == 0:
			return 85
		case i > 0:
			return 55
		}
		return 0
	}
	n := e.nameL
	if n == t {
		return 100
	}
	if i := strings.Index(n, t); i == 0 {
		return 90
	} else if i > 0 {
		switch n[i-1] {
		case '-', '.', '_':
			return 70
		}
		return 55
	}
	if e.nsL == t {
		return 35
	}
	if strings.Contains(e.nsL, t) {
		return 25
	}
	if inOrder(n, t) {
		return 12
	}
	return 0
}

func scoreAll(e *entry, terms []string) int {
	if len(terms) == 0 {
		return 1
	}
	sum := 0
	for _, t := range terms {
		s := scoreTerm(e, t)
		if s == 0 {
			return 0
		}
		sum += s
	}
	// Math.round in the TypeScript: halves round up.
	return (2*sum + len(terms)) / (2 * len(terms))
}

// The order ties between groups break in: the kinds the app follows come first.
var kindOrder = map[string]int{"pods": 0, "deployments": 1, "statefulsets": 2, "daemonsets": 3, "jobs": 4, "nodes": 5, "namespaces": 6}

func orderOf(slug string) int {
	if i, ok := kindOrder[slug]; ok {
		return i
	}
	return 99
}

func sortHits(hits []Hit, listing bool) {
	sort.SliceStable(hits, func(i, j int) bool {
		a, b := hits[i], hits[j]
		if listing {
			if a.Name != b.Name {
				return a.Name < b.Name
			}
			return a.NS < b.NS
		}
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		if len(a.Name) != len(b.Name) {
			return len(a.Name) < len(b.Name)
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.NS < b.NS
	})
}

func sortGroups(groups []Group) {
	sort.SliceStable(groups, func(i, j int) bool {
		a, b := groups[i], groups[j]
		as, bs := 0, 0
		if len(a.Hits) > 0 {
			as = a.Hits[0].Score
		}
		if len(b.Hits) > 0 {
			bs = b.Hits[0].Score
		}
		if as != bs {
			return as > bs
		}
		if oa, ob := orderOf(a.Slug), orderOf(b.Slug); oa != ob {
			return oa < ob
		}
		return a.Slug < b.Slug
	})
}
