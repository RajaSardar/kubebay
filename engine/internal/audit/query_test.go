package audit

import "testing"

func TestQuery_FiltersBeforeTailing(t *testing.T) {
	l := newTestLogger(t)
	l.Record(Entry{Action: "scale", Cluster: "c1", Namespace: "shop", Resource: "web", Detail: "replicas=3"})
	for i := 0; i < 5; i++ {
		l.Record(Entry{Action: "restart", Cluster: "c1", Namespace: "other", Resource: "noise"})
	}
	l.Record(Entry{Action: "restart", Cluster: "c2", Namespace: "shop", Resource: "web"})
	l.Record(Entry{Action: "delete", Cluster: "c1", Namespace: "shop", Resource: "web"})

	cases := []struct {
		name string
		f    Filter
		n    int
		want []string
	}{
		{"empty filter keeps all, tailed", Filter{}, 2, []string{"restart", "delete"}},
		{"cluster+ns+resource", Filter{Cluster: "c1", Namespace: "shop", Resource: "web"}, 10, []string{"scale", "delete"}},
		{"old entry survives a tail the noise would fill", Filter{Cluster: "c1", Resource: "web"}, 2, []string{"scale", "delete"}},
		{"no match", Filter{Resource: "nope"}, 10, []string{}},
		{"limit applies after filtering", Filter{Cluster: "c1", Resource: "web"}, 1, []string{"delete"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := l.Query(c.f, c.n)
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != len(c.want) {
				t.Fatalf("got %d entries, want %d", len(got), len(c.want))
			}
			for i, w := range c.want {
				if got[i].Action != w {
					t.Errorf("entry %d action = %q, want %q", i, got[i].Action, w)
				}
			}
		})
	}
}
