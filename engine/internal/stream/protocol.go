package stream

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/vmihailenco/msgpack/v5"
)

const (
	TypeSub    = "sub"
	TypeUnsub  = "unsub"
	TypeResync = "resync"
	TypePing   = "ping"

	TypeChanOpen   = "chan-open"
	TypeChanClose  = "chan-close"
	TypeChanResize = "chan-resize"

	TypeAck        = "ack"
	TypeError      = "error"
	TypeSync       = "sync"
	TypeChanClosed = "chan-closed"
	// TypeDenied names one namespace of a subscription that RBAC refuses;
	// the subscription goes on for the others.
	TypeDenied = "denied"

	TypeBegin    = "begin"
	TypeItems    = "items"
	TypeDelta    = "delta"
	TypeChanData = "chan-data"

	ModeMetadata = "metadata"
	ModeFull     = "full"

	ChanKindLogs = "logs"
	ChanKindExec = "exec"
	// ChanKindLocalShell runs a PTY on the machine hosting the engine.  It is
	// only ever accepted in binaries built with the "localshell" tag.
	ChanKindLocalShell = "local-shell"
)

type ClientFrame struct {
	Type          string   `json:"type"`
	ID            string   `json:"id,omitempty"`
	Cluster       string   `json:"cluster,omitempty"`
	GVR           string   `json:"gvr,omitempty"`
	Namespaces    []string `json:"ns,omitempty"`
	LabelSelector string   `json:"labelSelector,omitempty"`
	Mode          string   `json:"mode,omitempty"`

	Kind      string   `json:"kind,omitempty"`
	Namespace string   `json:"namespace,omitempty"`
	Pod       string   `json:"pod,omitempty"`
	Container string   `json:"container,omitempty"`
	Tail      int64    `json:"tail,omitempty"`
	Follow    bool     `json:"follow,omitempty"`
	Previous  bool     `json:"previous,omitempty"`
	Command   []string `json:"command,omitempty"`
	Cols      uint16   `json:"cols,omitempty"`
	Rows      uint16   `json:"rows,omitempty"`
}

type ControlFrame struct {
	Type    string `json:"type"`
	ID      string `json:"id,omitempty"`
	Message string `json:"message,omitempty"`
	RV      string `json:"rv,omitempty"`
	// NS is the namespace a "denied" frame is about.
	NS string `json:"ns,omitempty"`
}

// Denial is one namespace of a subscription that RBAC refuses: the
// subscription goes on for its other namespaces.
type Denial struct {
	NS      string
	Message string
}

const (
	OpAdd    = "a"
	OpModify = "m"
	OpDelete = "d"
)

type Op struct {
	Op  string         `msgpack:"op"`
	Key string         `msgpack:"key"`
	Obj map[string]any `msgpack:"obj,omitempty"`
	// enc, when set, is Obj's msgpack encoding, made the first time any
	// subscription sends the op and reused by every copy after: one update
	// fanned out to ten subscriptions is encoded once, not ten times.
	enc *sharedEncoding
}

type sharedEncoding struct {
	once sync.Once
	b    []byte
	err  error
}

// SharedOp is an op whose object is encoded once however many subscriptions
// it is pushed to. Obj must not change afterwards (informer cache objects
// never do: client-go replaces them).
func SharedOp(op, key string, obj map[string]any) Op {
	return Op{Op: op, Key: key, Obj: obj, enc: &sharedEncoding{}}
}

// Shared reports whether o was made by SharedOp.
func (o Op) Shared() bool { return o.enc != nil }

func (o Op) encodedObj() ([]byte, error) {
	o.enc.once.Do(func() { o.enc.b, o.enc.err = msgpack.Marshal(o.Obj) })
	return o.enc.b, o.enc.err
}

// EncodeMsgpack writes exactly what the default struct encoding writes (a
// map of op, key and, when not empty, obj) but takes obj's bytes from the
// shared encoding when there is one.
func (o Op) EncodeMsgpack(e *msgpack.Encoder) error {
	n := 2
	if len(o.Obj) > 0 {
		n = 3
	}
	if err := e.EncodeMapLen(n); err != nil {
		return err
	}
	if err := e.EncodeString("op"); err != nil {
		return err
	}
	if err := e.EncodeString(o.Op); err != nil {
		return err
	}
	if err := e.EncodeString("key"); err != nil {
		return err
	}
	if err := e.EncodeString(o.Key); err != nil {
		return err
	}
	if n == 2 {
		return nil
	}
	if err := e.EncodeString("obj"); err != nil {
		return err
	}
	if o.enc == nil {
		return e.EncodeMap(o.Obj)
	}
	b, err := o.encodedObj()
	if err != nil {
		return err
	}
	return msgpack.RawMessage(b).EncodeMsgpack(e)
}

type DataFrame struct {
	Type string         `msgpack:"type"`
	ID   string         `msgpack:"id"`
	RV   string         `msgpack:"rv,omitempty"`
	Ops  []Op           `msgpack:"ops,omitempty"`
	Data []byte         `msgpack:"data,omitempty"`
	Meta map[string]any `msgpack:"meta,omitempty"`
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
	case TypeSub, TypeUnsub, TypeResync, TypePing, TypeChanOpen, TypeChanClose, TypeChanResize:
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

// encodeFrame writes the bytes msgpack.Marshal(f) writes (a map of the
// fields in declared order, empty ones left out) without the reflection
// that costs several allocations per frame.
func encodeFrame(e *msgpack.Encoder, f *DataFrame) error {
	n := 2
	for _, set := range [...]bool{f.RV != "", len(f.Ops) > 0, len(f.Data) > 0, len(f.Meta) > 0} {
		if set {
			n++
		}
	}
	if err := e.EncodeMapLen(n); err != nil {
		return err
	}
	if err := encodeStringField(e, "type", f.Type); err != nil {
		return err
	}
	if err := encodeStringField(e, "id", f.ID); err != nil {
		return err
	}
	if f.RV != "" {
		if err := encodeStringField(e, "rv", f.RV); err != nil {
			return err
		}
	}
	if len(f.Ops) > 0 {
		if err := e.EncodeString("ops"); err != nil {
			return err
		}
		if err := e.EncodeArrayLen(len(f.Ops)); err != nil {
			return err
		}
		for i := range f.Ops {
			if err := f.Ops[i].EncodeMsgpack(e); err != nil {
				return err
			}
		}
	}
	if len(f.Data) > 0 {
		if err := e.EncodeString("data"); err != nil {
			return err
		}
		if err := e.EncodeBytes(f.Data); err != nil {
			return err
		}
	}
	if len(f.Meta) > 0 {
		if err := e.EncodeString("meta"); err != nil {
			return err
		}
		if err := e.EncodeMap(f.Meta); err != nil {
			return err
		}
	}
	return nil
}

func encodeStringField(e *msgpack.Encoder, name, v string) error {
	if err := e.EncodeString(name); err != nil {
		return err
	}
	return e.EncodeString(v)
}

// maxPooledFrame is the largest buffer kept for reuse; a bigger snapshot
// frame's buffer is left to the GC.
const maxPooledFrame = 4 << 20

var frameBufs = sync.Pool{New: func() any { return new(bytes.Buffer) }}

// withEncodedData encodes f into a pooled buffer and hands the bytes to
// send, which must not keep them after it returns.
func withEncodedData(f *DataFrame, send func([]byte) error) error {
	buf := frameBufs.Get().(*bytes.Buffer)
	buf.Reset()
	enc := msgpack.GetEncoder()
	enc.Reset(buf)
	err := encodeFrame(enc, f)
	msgpack.PutEncoder(enc)
	if err == nil {
		err = send(buf.Bytes())
	}
	if buf.Cap() <= maxPooledFrame {
		frameBufs.Put(buf)
	}
	return err
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

// Why the engine ended a subscription, sent as the error frame's message.
// The web client matches ReasonCredentialsChanged exactly and resubscribes.
const (
	ReasonDisconnected       = "cluster disconnected"
	ReasonCredentialsChanged = "cluster credentials changed"
	// ReasonForbidden prefixes the API server's message when RBAC doesn't
	// let this identity list or watch the resource.
	ReasonForbidden = "forbidden: "
)
