package httpapi

import (
	"context"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

func as(user string) context.Context {
	if user == "" {
		return context.Background()
	}
	return clusters.WithIdentity(context.Background(), &clusters.Identity{Name: user})
}

// In OIDC mode one engine serves many users: a port-forward belongs to the
// user who started it, and nobody else may see or stop it.
func TestPortForwardsAreScopedToTheUserWhoStartedThem(t *testing.T) {
	p := &PFManager{m: map[string]*pfEntry{
		"a": {fw: PortForward{ID: "a", Cluster: "c1", Pod: "alice-db"}, owner: "alice", stop: make(chan struct{})},
		"b": {fw: PortForward{ID: "b", Cluster: "c1", Pod: "bob-api"}, owner: "bob", stop: make(chan struct{})},
		"d": {fw: PortForward{ID: "d", Cluster: "c1", Pod: "desktop"}, stop: make(chan struct{})},
	}}

	if got := p.List(as("alice")); len(got) != 1 || got[0].ID != "a" {
		t.Errorf("alice sees %+v, want only her own forward", got)
	}
	if got := p.List(as("")); len(got) != 1 || got[0].ID != "d" {
		t.Errorf("without an identity (desktop) only unowned forwards show: %+v", got)
	}

	stopA := p.m["a"].stop
	if p.Stop(as("bob"), "a") {
		t.Error("bob must not be able to stop alice's forward")
	}
	select {
	case <-stopA:
		t.Fatal("alice's tunnel was closed by bob")
	default:
	}
	if !p.Stop(as("alice"), "a") {
		t.Error("alice stops her own forward")
	}
	if got := p.List(as("alice")); len(got) != 0 {
		t.Errorf("after stopping: %+v", got)
	}
}
