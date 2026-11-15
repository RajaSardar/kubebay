package stream

import (
	"testing"
)

func TestClientFrameRoundtrip(t *testing.T) {
	in := []byte(`{"type":"sub","id":"s1","cluster":"prod","gvr":"apps/v1/deployments","ns":["a","b"],"labelSelector":"app=x"}`)
	f, err := DecodeClient(in)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if f.ID != "s1" || f.Cluster != "prod" || f.GVR != "apps/v1/deployments" || len(f.Namespaces) != 2 || f.LabelSelector != "app=x" {
		t.Fatalf("unexpected frame: %+v", f)
	}
}

func TestDecodeClientRejectsUnknownType(t *testing.T) {
	if _, err := DecodeClient([]byte(`{"type":"explode"}`)); err == nil {
		t.Fatal("expected error for unknown type")
	}
	if _, err := DecodeClient([]byte(`{"type":"sub"}`)); err == nil {
		t.Fatal("expected error for missing id/cluster/gvr")
	}
}

func TestDataFrameMsgpackRoundtrip(t *testing.T) {
	in := &DataFrame{
		Type: TypeDelta,
		ID:   "s1",
		RV:   "1234",
		Ops: []Op{
			{Op: OpAdd, Key: "ns/a", Obj: map[string]any{"metadata": map[string]any{"name": "a", "namespace": "ns"}}},
			{Op: OpDelete, Key: "ns/b"},
		},
	}
	b, err := EncodeData(in)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	out, err := DecodeData(b)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Type != TypeDelta || out.RV != "1234" || len(out.Ops) != 2 {
		t.Fatalf("unexpected frame: %+v", out)
	}
	key, err := ObjectKey(out.Ops[0].Obj)
	if err != nil || key != "ns/a" {
		t.Fatalf("object key = %q, %v", key, err)
	}
}

func TestObjectKeyClusterScoped(t *testing.T) {
	obj := map[string]any{"metadata": map[string]any{"name": "node-1"}}
	k, err := ObjectKey(obj)
	if err != nil || k != "node-1" {
		t.Fatalf("got %q, %v", k, err)
	}
}
