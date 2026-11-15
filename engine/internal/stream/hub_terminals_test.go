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

// blockingDeps holds every channel open until its context ends.
type blockingDeps struct{}

func (blockingDeps) OpenLogs(ctx context.Context, _ ChanSpec, _ func([]byte) error) error {
	<-ctx.Done()
	return nil
}

func (blockingDeps) OpenExec(ctx context.Context, _ ChanSpec, _ func([]byte) error, _ io.Reader, _ <-chan TermSize) error {
	<-ctx.Done()
	return nil
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// KB-04: the desktop app won't restart to update while a terminal is open, so
// the hub counts them. A log stream isn't a terminal.
func TestHubCountsOpenTerminals(t *testing.T) {
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), blockingDeps{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Handle(w, r, closingSource{&closingHandle{snap: make(chan Snapshot), deltas: make(chan []Op)}}, "")
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	send := func(f ClientFrame) {
		b, _ := json.Marshal(f)
		if err := c.Write(ctx, websocket.MessageText, b); err != nil {
			t.Fatal(err)
		}
	}
	// Drain the socket so the hub's writes never block.
	go func() {
		for {
			if _, _, err := c.Read(ctx); err != nil {
				return
			}
		}
	}()

	if n := hub.Terminals(); n != 0 {
		t.Fatalf("terminals before any channel = %d", n)
	}
	send(ClientFrame{Type: TypeChanOpen, ID: "logs", Kind: ChanKindLogs, Cluster: "c1", Namespace: "ns", Pod: "p", Follow: true})
	send(ClientFrame{Type: TypeChanOpen, ID: "sh1", Kind: ChanKindExec, Cluster: "c1", Namespace: "ns", Pod: "p"})
	send(ClientFrame{Type: TypeChanOpen, ID: "sh2", Kind: ChanKindExec, Cluster: "c1", Namespace: "ns", Pod: "p"})
	waitFor(t, "two terminals", func() bool { return hub.Terminals() == 2 })

	send(ClientFrame{Type: TypeChanClose, ID: "sh1"})
	waitFor(t, "one terminal", func() bool { return hub.Terminals() == 1 })
	send(ClientFrame{Type: TypeChanClose, ID: "logs"})
	time.Sleep(50 * time.Millisecond)
	if n := hub.Terminals(); n != 1 {
		t.Errorf("closing the log stream changed terminals to %d", n)
	}

	// The socket going away ends its terminals too.
	_ = c.Close(websocket.StatusNormalClosure, "")
	waitFor(t, "no terminals", func() bool { return hub.Terminals() == 0 })
}
