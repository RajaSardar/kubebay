package stream

import (
	"encoding/json"
	"fmt"

	"github.com/vmihailenco/msgpack/v5"
)

const (
	TypeSub    = "sub"
	TypeUnsub  = "unsub"
	TypeResync = "resync"
	TypePing   = "ping"

	TypeAck   = "ack"
	TypeError = "error"
	TypeSync  = "sync"

	TypeBegin = "begin"
	TypeItems = "items"
	TypeDelta = "delta"

	ModeMetadata = "metadata"
	ModeFull     = "full"
)

type ClientFrame struct {
	Type          string   `json:"type"`
	ID            string   `json:"id,omitempty"`
	Cluster       string   `json:"cluster,omitempty"`
	GVR           string   `json:"gvr,omitempty"`
	Namespaces    []string `json:"ns,omitempty"`
	LabelSelector string   `json:"labelSelector,omitempty"`
}

type ControlFrame struct {
	Type    string `json:"type"`
	ID      string `json:"id,omitempty"`
	Message string `json:"message,omitempty"`
	RV      string `json:"rv,omitempty"`
}

const (
	OpAdd    = "a"
	OpModify = "m"
	OpDelete = "d"
)

type Op struct {
	Op   string         `msgpack:"op"`
	Key  string         `msgpack:"key"`
	Obj  map[string]any `msgpack:"obj,omitempty"`
}

type DataFrame struct {
	Type string `msgpack:"type"`
	ID   string `msgpack:"id"`
	RV   string `msgpack:"rv,omitempty"`
	Ops  []Op   `msgpack:"ops"`
}

func EncodeControl(f ControlFrame) ([]byte, error) {
	return json.Marshal(f)
}

func DecodeClient(b []byte) (*ClientFrame, error) {
	var f ClientFrame
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, err
	}
	switch f.Type {
	case TypeSub, TypeUnsub, TypeResync, TypePing:
	default:
		return nil, fmt.Errorf("unknown client frame type %q", f.Type)
	}
	if f.Type == TypeSub && (f.ID == "" || f.Cluster == "" || f.GVR == "") {
		return nil, fmt.Errorf("sub requires id, cluster, gvr")
	}
	return &f, nil
}

func EncodeData(f *DataFrame) ([]byte, error) {
	return msgpack.Marshal(f)
}

func DecodeData(b []byte) (*DataFrame, error) {
	var f DataFrame
	if err := msgpack.Unmarshal(b, &f); err != nil {
		return nil, err
	}
	return &f, nil
}

func ObjectKey(obj map[string]any) (string, error) {
	meta, ok := obj["metadata"].(map[string]any)
	if !ok {
		return "", fmt.Errorf("object missing metadata")
	}
	name, _ := meta["name"].(string)
	ns, _ := meta["namespace"].(string)
	if name == "" {
		return "", fmt.Errorf("object missing name")
	}
	if ns == "" {
		return name, nil
	}
	return ns + "/" + name, nil
}

func ObjectRV(obj map[string]any) string {
	meta, ok := obj["metadata"].(map[string]any)
	if !ok {
		return ""
	}
	rv, _ := meta["resourceVersion"].(string)
	return rv
}
