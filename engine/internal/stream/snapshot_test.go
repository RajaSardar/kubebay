package stream

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// A subscription's snapshot used to be every object made an op before the
// first frame went out: with 100k pods, 100k copies at once (KB-02). It is
// built a frame at a time as the hub sends it.

// numbered is n items, made ops on demand; built counts how many have been.
// Item 7 has no key, so it isn't an op.
func numbered(n int, built *int) Snapshot {
	items := make([]any, n)
	for i := range items {
		items[i] = i
	}
	return NewSnapshot(items, func(it any) (Op, bool) {
		*built++
		if it.(int) == 7 {
			return Op{}, false
		}
		return Op{Op: OpAdd, Key: fmt.Sprintf("ns/item-%d", it)}, true
	})
}

func TestASnapshotIsBuiltAFrameAtATime(t *testing.T) {
	built := 0
	snap := numbered(450, &built)
	if snap.Len() != 450 {
		t.Fatalf("Len = %d, want 450", snap.Len())
	}
	if built != 0 {
		t.Fatalf("%d ops built before any were read", built)
	}
	var sizes []int
	for ops := range snap.Frames(200) {
		if limit := (len(sizes) + 1) * 200; built > limit {
			t.Fatalf("%d ops built by frame %d, want at most %d: one frame ahead", built, len(sizes), limit)
		}
		sizes = append(sizes, len(ops))
	}
	if fmt.Sprint(sizes) != "[199 200 50]" {
		t.Fatalf("frames of %v ops, want [199 200 50]: 200 items a frame, the one without a key left out", sizes)
	}
}

func TestASnapshotCanBeReadWhole(t *testing.T) {
	built := 0
	if all := numbered(10, &built).All(); len(all) != 9 || all[0].Key != "ns/item-0" || all[8].Key != "ns/item-9" {
		t.Fatalf("All = %v, want items 0-9 but 7", all)
	}
	ops := []Op{{Op: OpAdd, Key: "a/x"}, {Op: OpAdd, Key: "a/y"}}
	if got := OpsSnapshot(ops).All(); fmt.Sprint(got) != fmt.Sprint(ops) {
		t.Fatalf("OpsSnapshot(ops).All() = %v, want %v", got, ops)
	}
}

type lazyHandle struct {
	snap chan Snapshot
}

func (h lazyHandle) ID() string                { return "h1" }
func (h lazyHandle) Snapshot() <-chan Snapshot { return h.snap }
func (h lazyHandle) Deltas() <-chan []Op       { return nil }

type lazySource struct{ handle lazyHandle }

func (s lazySource) Subscribe(context.Context, string, string, []string, string, string) (SubHandle, error) {
	return s.handle, nil
}

func TestHubSendsASnapshotFrameByFrame(t *testing.T) {
	handle := lazyHandle{snap: make(chan Snapshot, 1)}
	built := 0
	handle.snap <- numbered(450, &built)
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Handle(w, r, lazySource{handle}, "")
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	sub, _ := json.Marshal(ClientFrame{Type: TypeSub, ID: "s1", Cluster: "c1", GVR: "v1/pods"})
	if err := c.Write(ctx, websocket.MessageText, sub); err != nil {
		t.Fatal(err)
	}

	var seen []string
	for {
		typ, b, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("read after %v: %v", seen, err)
		}
		if typ == websocket.MessageText {
			var f ControlFrame
			_ = json.Unmarshal(b, &f)
			seen = append(seen, f.Type)
			if f.Type == TypeSync {
				break
			}
			continue
		}
		f, err := DecodeData(b)
		if err != nil {
			t.Fatal(err)
		}
		seen = append(seen, fmt.Sprintf("%s:%d", f.Type, len(f.Ops)))
	}
	if got := strings.Join(seen, " "); got != "ack begin:0 items:199 items:200 items:50 sync" {
		t.Fatalf("frames = %s, want ack, begin, the snapshot 200 items a frame, then sync", got)
	}
}
