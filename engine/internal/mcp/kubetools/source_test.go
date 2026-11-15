package kubetools

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
)

type forbiddingConfigs struct{ host string }

func (f forbiddingConfigs) RestConfig(string) (*rest.Config, error) {
	return &rest.Config{Host: f.host}, nil
}

func (f forbiddingConfigs) RestConfigWithIdentity(string, *clusters.Identity) (*rest.Config, error) {
	return &rest.Config{Host: f.host}, nil
}

// An assistant asking for something RBAC refuses gets the refusal at once,
// not a 20 s "timed out waiting to sync".
func TestSnapshotReturnsARefusalInsteadOfTimingOut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403,"message":"pods is forbidden: User \"dev\" cannot list resource \"pods\""}`))
	}))
	defer srv.Close()
	reg := informers.NewPoolRegistry(forbiddingConfigs{srv.URL})
	defer reg.Close("c1")

	start := time.Now()
	_, err := PoolSource{Pools: reg, Timeout: 20 * time.Second}.Snapshot(context.Background(), "c1", "v1/pods", nil, "", informers.ModeFull)
	if err == nil || !strings.Contains(err.Error(), "forbidden") {
		t.Fatalf("err = %v, want the refusal", err)
	}
	if d := time.Since(start); d > 3*time.Second {
		t.Fatalf("took %v: the refusal should come back at once", d)
	}
}
