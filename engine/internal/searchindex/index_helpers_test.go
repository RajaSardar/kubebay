package searchindex

// newForTest is an index with no subscriber, whose kinds appear as objects are put.
func newForTest(aliases map[string]string) *Index {
	ix := New(nil, nil, DefaultLimits)
	ix.aliases = aliases
	return ix
}

func (ix *Index) putForTest(slug, ns, name string) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	st := ix.kinds[slug]
	if st == nil {
		ix.addKind(Kind{Slug: slug, Label: slug, Synthetic: true})
		st = ix.kinds[slug]
	}
	st.entries[ns+"/"+name] = newEntry(ns, name)
	ix.total.Add(1)
}
