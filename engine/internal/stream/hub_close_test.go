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

type reasonHandle struct {
	*closingHandle
	reason string
}

func (h reasonHandle) CloseReason() string { return h.reason }

type reasonSource struct{ handle reasonHandle }

func (s reasonSource) Subscribe(context.Context, string, string, []string, string, string) (SubHandle, error) {
	return s.handle, nil
}

func TestHubPassesOnWhyTheEngineClosedAStream(t *testing.T) {
	handle := reasonHandle{&closingHandle{snap: make(chan []Op), deltas: make(chan []Op)}, ReasonCredentialsChanged}
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Handle(w, r, reasonSource{handle}, "")
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
	_ = c.Write(ctx, websocket.MessageText, sub)
	var f ControlFrame
	for f.Type != TypeAck {
		_, b, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_ = json.Unmarshal(b, &f)
	}
	close(handle.deltas)
	_, b, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(b, &f)
	if f.Type != TypeError || f.ID != "s1" || f.Message != ReasonCredentialsChanged {
		t.Errorf("got %+v, want an error frame for s1 carrying %q", f, ReasonCredentialsChanged)
	}
}

type ctxKey struct{}

type ctxSource struct {
	handle *closingHandle
	got    chan any
}

func (s ctxSource) Subscribe(ctx context.Context, _, _ string, _ []string, _, _ string) (SubHandle, error) {
	s.got <- ctx.Value(ctxKey{})
	return s.handle, nil
}

// The auth middleware puts the logged-in identity on the request context;
// the pool registry reads it from the subscribe context to impersonate.
func TestHubSubscribesWithTheRequestContext(t *testing.T) {
	src := ctxSource{handle: &closingHandle{snap: make(chan []Op), deltas: make(chan []Op)}, got: make(chan any, 1)}
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Handle(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, "alice")), src, "")
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
	select {
	case v := <-src.got:
		if v != "alice" {
			t.Errorf("subscribe context value = %v, want the request's identity", v)
		}
	case <-ctx.Done():
		t.Fatal("never subscribed")
	}
}
