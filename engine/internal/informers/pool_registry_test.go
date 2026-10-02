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
