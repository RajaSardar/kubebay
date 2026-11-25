package informers

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// A delta goes to every subscription of the entry as copies of one op; the
// op must carry a shared encoding so the object is encoded once for all of
// them, not once per subscription.
func TestEmitMakesASharedOp(t *testing.T) {
	e := &entry{fanout: make(chan stream.Op, 1)}
	e.emit(stream.OpModify, &unstructured.Unstructured{Object: map[string]any{
		"metadata": map[string]any{"namespace": "shop", "name": "api"},
	}})
	op := <-e.fanout
	if op.Key != "shop/api" || op.Op != stream.OpModify {
		t.Fatalf("op = %+v", op)
	}
	if !op.Shared() {
		t.Fatal("the fanout op does not share its encoding")
	}
}
