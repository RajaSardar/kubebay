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

type denyingHandle struct {
	*closingHandle
	deny chan Denial
}

func (h denyingHandle) Denials() <-chan Denial { return h.deny }

type denyingSource struct{ handle denyingHandle }

func (s denyingSource) Subscribe(context.Context, string, string, []string, string, string) (SubHandle, error) {
	return s.handle, nil
}

// A namespace RBAC refuses is named to the client as a "denied" frame; the
// stream stays open for the subscription's other namespaces.
func TestHubNamesARefusedNamespace(t *testing.T) {
	handle := denyingHandle{&closingHandle{snap: make(chan Snapshot), deltas: make(chan []Op)}, make(chan Denial, 1)}
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Handle(w, r, denyingSource{handle}, "")
	}))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	sub, _ := json.Marshal(ClientFrame{Type: TypeSub, ID: "s1", Cluster: "c1", GVR: "v1/pods", Namespaces: []string{"shop", "payments"}})
	_ = c.Write(ctx, websocket.MessageText, sub)
	var f ControlFrame
	for f.Type != TypeAck {
		_, b, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_ = json.Unmarshal(b, &f)
	}

	handle.deny <- Denial{NS: "payments", Message: `pods is forbidden: User "dev" cannot list resource "pods" in the namespace "payments"`}
	_, b, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	f = ControlFrame{}
	_ = json.Unmarshal(b, &f)
	if f.Type != TypeDenied || f.ID != "s1" || f.NS != "payments" || !strings.Contains(f.Message, `"payments"`) {
		t.Fatalf("got %+v, want a denied frame for s1 naming payments with the reason", f)
	}
}
