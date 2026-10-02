package stream

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type closingHandle struct {
	snap   chan []Op
	deltas chan []Op
}

func (h *closingHandle) ID() string            { return "h1" }
func (h *closingHandle) Snapshot() <-chan []Op { return h.snap }
func (h *closingHandle) Deltas() <-chan []Op   { return h.deltas }

type closingSource struct{ handle *closingHandle }

func (s closingSource) Subscribe(context.Context, string, string, []string, string, string) (SubHandle, error) {
	return s.handle, nil
}

// When the engine tears a stream down (the cluster was disconnected), the
// client must be told, or the table keeps showing frozen rows as live.
func TestHubReportsAStreamTheEngineClosed(t *testing.T) {
	handle := &closingHandle{snap: make(chan []Op), deltas: make(chan []Op)}
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Handle(w, r, closingSource{handle}, "")
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
	readControl := func() ControlFrame {
		for {
			typ, b, err := c.Read(ctx)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if typ != websocket.MessageText {
				continue
			}
			var f ControlFrame
			_ = json.Unmarshal(b, &f)
			return f
		}
	}
	if f := readControl(); f.Type != TypeAck {
		t.Fatalf("first frame = %+v, want ack", f)
	}
	close(handle.deltas)
	f := readControl()
	if f.Type != TypeError || f.ID != "s1" || !strings.Contains(f.Message, "disconnected") {
		t.Errorf("after the engine closed the stream got %+v, want an error frame for s1 saying it was disconnected", f)
	}
}
