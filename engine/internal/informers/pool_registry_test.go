package informers

import (
	"context"
	"testing"
	"time"

	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

type fakeConfigs struct{}

func (fakeConfigs) RestConfig(string) (*rest.Config, error) {
	return &rest.Config{Host: "https://127.0.0.1:1"}, nil
}

func (fakeConfigs) RestConfigWithIdentity(string, *clusters.Identity) (*rest.Config, error) {
	return &rest.Config{Host: "https://127.0.0.1:1"}, nil
}

func TestCloseTearsDownEveryPoolForACluster(t *testing.T) {
	reg := NewPoolRegistry(fakeConfigs{})
	ctx := context.Background()
	own, err := reg.ForUser(ctx, "c1", nil)
	if err != nil {
		t.Fatal(err)
	}
	alice, _ := reg.ForUser(ctx, "c1", &clusters.Identity{Name: "alice"})
	other, _ := reg.ForUser(ctx, "c2", nil)
	sub, err := own.Subscribe(ctx, "v1/pods", nil, "", ModeMetadata)
	if err != nil {
		t.Fatal(err)
	}

	reg.Close("c1")

	select {
	case _, ok := <-sub.Deltas():
		if ok {
			// a flush may race the close; the next read must see it closed
			if _, ok2 := <-sub.Deltas(); ok2 {
				t.Fatal("deltas still open after Close")
			}
		}
	case <-time.After(2 * time.Second):
		t.Fatal("an open subscription was not closed by Close")
	}
	if !own.Closed() || !alice.Closed() {
		t.Error("every pool of c1, including impersonated ones, must close")
	}
	if other.Closed() {
		t.Error("c2 must be untouched")
	}
	again, _ := reg.ForUser(ctx, "c1", nil)
	if again == own {
		t.Error("connecting again must build a fresh pool")
	}
	if _, err := own.Subscribe(ctx, "v1/pods", nil, "", ModeMetadata); err == nil {
		t.Error("a closed pool must refuse new subscriptions")
	}
}

type recordingConfigs struct{ seen []*clusters.Identity }

func (r *recordingConfigs) RestConfig(string) (*rest.Config, error) {
	return &rest.Config{Host: "https://127.0.0.1:1"}, nil
}

func (r *recordingConfigs) RestConfigWithIdentity(_ string, ident *clusters.Identity) (*rest.Config, error) {
	r.seen = append(r.seen, ident)
	return &rest.Config{Host: "https://127.0.0.1:1"}, nil
}

// OIDC mode: a stream opened by a logged-in user must impersonate that user,
// never run with the engine's own (usually broader) credentials.
func TestForImpersonatesTheIdentityOnTheContext(t *testing.T) {
	src := &recordingConfigs{}
	reg := NewPoolRegistry(src)
	alice := &clusters.Identity{Name: "alice", Groups: []string{"dev"}}

	pa, err := reg.For(clusters.WithIdentity(context.Background(), alice), "c1")
	if err != nil {
		t.Fatal(err)
	}
	if len(src.seen) != 1 || src.seen[0] == nil || src.seen[0].Name != "alice" {
		t.Fatalf("config resolved for %+v, want alice", src.seen)
	}
	own, _ := reg.For(context.Background(), "c1")
	if own == pa {
		t.Fatal("the engine's own pool must not be shared with an impersonated user")
	}
	if again, _ := reg.For(clusters.WithIdentity(context.Background(), alice), "c1"); again != pa {
		t.Error("the same user must reuse their pool")
	}
}

func TestPoolsAreKeyedByGroupsToo(t *testing.T) {
	reg := NewPoolRegistry(&recordingConfigs{})
	ctx := context.Background()
	dev, _ := reg.ForUser(ctx, "c1", &clusters.Identity{Name: "alice", Groups: []string{"dev"}})
	admin, _ := reg.ForUser(ctx, "c1", &clusters.Identity{Name: "alice", Groups: []string{"dev", "admins"}})
	if dev == admin {
		t.Error("a changed group membership must not reuse the pool impersonating the old groups")
	}
	same, _ := reg.ForUser(ctx, "c1", &clusters.Identity{Name: "alice", Groups: []string{"admins", "dev"}})
	if same != admin {
		t.Error("group order must not matter")
	}
	reg.Close("c1")
	if !dev.Closed() || !admin.Closed() {
		t.Error("Close must still reach every impersonated pool")
	}
}
