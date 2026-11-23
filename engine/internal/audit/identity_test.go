package audit

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

func TestUserFrom_OIDCIdentityElseLocal(t *testing.T) {
	if got := UserFrom(context.Background()); got != LocalUser {
		t.Errorf("no identity: got %q, want %q", got, LocalUser)
	}
	ctx := clusters.WithIdentity(context.Background(), &clusters.Identity{Name: "alice@example.com"})
	if got := UserFrom(ctx); got != "alice@example.com" {
		t.Errorf("OIDC identity: got %q, want alice@example.com", got)
	}
	empty := clusters.WithIdentity(context.Background(), &clusters.Identity{})
	if got := UserFrom(empty); got != LocalUser {
		t.Errorf("identity with no name: got %q, want %q", got, LocalUser)
	}
}

func TestRecordCtx_StampsUserAndKeepsGVR(t *testing.T) {
	l := newTestLogger(t)
	ctx := clusters.WithIdentity(context.Background(), &clusters.Identity{Name: "bob@example.com"})
	l.RecordCtx(ctx, Entry{Action: "scale", Cluster: "c1", GVR: "apps/v1/deployments", Namespace: "shop", Resource: "web"})
	l.RecordCtx(context.Background(), Entry{Action: "restart", Cluster: "c1"})
	// An explicit user is kept, not overwritten.
	l.RecordCtx(ctx, Entry{Action: "delete", Cluster: "c1", User: "explicit"})

	got, err := l.Tail(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("got %d entries, want 3", len(got))
	}
	if got[0].User != "bob@example.com" || got[0].GVR != "apps/v1/deployments" {
		t.Errorf("entry 0 = %+v, want user bob and gvr apps/v1/deployments", got[0])
	}
	if got[1].User != LocalUser {
		t.Errorf("entry 1 user = %q, want %q", got[1].User, LocalUser)
	}
	if got[2].User != "explicit" {
		t.Errorf("entry 2 user = %q, want explicit", got[2].User)
	}
}

func TestRecord_WithoutUserIsLocal(t *testing.T) {
	l := newTestLogger(t)
	l.Record(Entry{Action: "mcp:list_resources", Source: "mcp"})
	got, _ := l.Tail(1)
	if len(got) != 1 || got[0].User != LocalUser {
		t.Fatalf("got %+v, want user %q", got, LocalUser)
	}
}

func TestQuery_FiltersByUserAndKind(t *testing.T) {
	l := newTestLogger(t)
	l.Record(Entry{Action: "scale", User: "alice", GVR: "apps/v1/deployments", Resource: "web"})
	l.Record(Entry{Action: "delete", User: "bob", GVR: "v1/services", Resource: "web"})
	l.Record(Entry{Action: "drain", User: "alice", GVR: "v1/nodes", Resource: "n1"})

	cases := []struct {
		name string
		f    Filter
		want []string
	}{
		{"user", Filter{User: "alice"}, []string{"scale", "drain"}},
		{"kind as full gvr", Filter{Kind: "apps/v1/deployments"}, []string{"scale"}},
		{"kind as plural resource", Filter{Kind: "services"}, []string{"delete"}},
		{"kind is case-insensitive", Filter{Kind: "Nodes"}, []string{"drain"}},
		{"user and kind", Filter{User: "alice", Kind: "services"}, []string{}},
		{"user and resource", Filter{User: "bob", Resource: "web"}, []string{"delete"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := l.Query(c.f, 10)
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != len(c.want) {
				t.Fatalf("got %d entries (%+v), want %v", len(got), got, c.want)
			}
			for i, w := range c.want {
				if got[i].Action != w {
					t.Errorf("entry %d = %q, want %q", i, got[i].Action, w)
				}
			}
		})
	}
}

// Lines written before user and gvr existed still decode; they have no user,
// so a per-user filter (an OIDC user's own view) never shows them.
func TestQuery_OldLinesWithoutUserOrGVR(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "audit.log")
	old := `{"time":"2026-01-01T00:00:00Z","action":"delete","cluster":"c1","namespace":"shop","resource":"web","detail":"gvr=apps/v1/deployments"}` + "\n"
	if err := os.WriteFile(path, []byte(old), 0600); err != nil {
		t.Fatal(err)
	}
	l := &Logger{path: path}

	all, err := l.Query(Filter{}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].User != "" || all[0].GVR != "" || all[0].Resource != "web" {
		t.Fatalf("old line decoded as %+v", all)
	}
	if got, _ := l.Query(Filter{User: "alice"}, 10); len(got) != 0 {
		t.Errorf("user filter matched an entry with no user: %+v", got)
	}
	if got, _ := l.Query(Filter{Kind: "deployments"}, 10); len(got) != 0 {
		t.Errorf("kind filter matched an entry with no gvr: %+v", got)
	}
}
