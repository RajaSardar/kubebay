package stream

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	writeTimeout  = 10 * time.Second
	maxFrameSize  = 8 << 20
	itemsPerFrame = 200
)

type Hub struct {
	log *slog.Logger
}

type SubSource interface {
	Subscribe(ctx context.Context, cluster, gvr string, namespaces []string, selector string) (SubHandle, error)
}

type SubHandle interface {
	ID() string
	Snapshot() <-chan []Op
	Deltas() <-chan []Op
}

func NewHub(log *slog.Logger) *Hub { return &Hub{log: log} }

type subTable struct {
	mu sync.Mutex
	m  map[string]context.CancelFunc
}

func newSubTable() *subTable { return &subTable{m: map[string]context.CancelFunc{}} }

func (t *subTable) put(id string, cancel context.CancelFunc) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if prev, ok := t.m[id]; ok {
		prev()
	}
	t.m[id] = cancel
}

func (t *subTable) drop(id string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if cancel, ok := t.m[id]; ok {
		cancel()
		delete(t.m, id)
		return true
	}
	return false
}

func (t *subTable) stopAll() {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, cancel := range t.m {
		cancel()
	}
	t.m = map[string]context.CancelFunc{}
}

type connWriter struct {
	mu sync.Mutex
	c  *websocket.Conn
}

func (w *connWriter) write(ctx context.Context, typ websocket.MessageType, b []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	wctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
	defer cancel()
	return w.c.Write(wctx, typ, b)
}

func (w *connWriter) sendControl(f ControlFrame) error {
	b, err := EncodeControl(f)
	if err != nil {
		return err
	}
	return w.write(context.Background(), websocket.MessageText, b)
}

func (w *connWriter) sendData(f *DataFrame) error {
	b, err := EncodeData(f)
	if err != nil {
		return err
	}
	return w.write(context.Background(), websocket.MessageBinary, b)
}

func (h *Hub) Handle(w http.ResponseWriter, r *http.Request, src SubSource) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:*", "127.0.0.1:*"},
	})
	if err != nil {
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	c.SetReadLimit(maxFrameSize)

	ctx := r.Context()
	writer := &connWriter{c: c}
	table := newSubTable()
	var wg sync.WaitGroup
	defer func() {
		table.stopAll()
		wg.Wait()
	}()

	for {
		msgType, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		if msgType != websocket.MessageText {
			continue
		}
		frame, err := DecodeClient(data)
		if err != nil {
			_ = writer.sendControl(ControlFrame{Type: TypeError, Message: err.Error()})
			continue
		}
		switch frame.Type {
		case TypePing:
			_ = writer.sendControl(ControlFrame{Type: "pong", ID: frame.ID})
		case TypeUnsub:
			if table.drop(frame.ID) {
				wg.Wait()
				_ = writer.sendControl(ControlFrame{Type: TypeAck, ID: frame.ID, Message: "unsubscribed"})
			} else {
				_ = writer.sendControl(ControlFrame{Type: TypeError, ID: frame.ID, Message: "unknown subscription"})
			}
		case TypeResync:
			table.drop(frame.ID)
			wg.Wait()
			h.start(ctx, frame, src, writer, table, &wg)
		case TypeSub:
			h.start(ctx, frame, src, writer, table, &wg)
		}
	}
}

func (h *Hub) start(parent context.Context, frame *ClientFrame, src SubSource, writer *connWriter, table *subTable, wg *sync.WaitGroup) {
	subCtx, cancel := context.WithCancel(parent)
	handle, err := src.Subscribe(subCtx, frame.Cluster, frame.GVR, frame.Namespaces, frame.LabelSelector)
	if err != nil {
		cancel()
		_ = writer.sendControl(ControlFrame{Type: TypeError, ID: frame.ID, Message: err.Error()})
		return
	}
	table.put(frame.ID, cancel)
	_ = writer.sendControl(ControlFrame{Type: TypeAck, ID: frame.ID, Message: "subscribed"})

	wg.Add(1)
	go func() {
		defer wg.Done()
		synced := false
		for {
			select {
			case <-subCtx.Done():
				return
			case snap := <-handle.Snapshot():
				_ = writer.sendData(&DataFrame{Type: TypeBegin, ID: frame.ID})
				for i := 0; i < len(snap); i += itemsPerFrame {
					end := min(i+itemsPerFrame, len(snap))
					_ = writer.sendData(&DataFrame{Type: TypeItems, ID: frame.ID, Ops: snap[i:end]})
				}
				_ = writer.sendControl(ControlFrame{Type: TypeSync, ID: frame.ID})
				synced = true
			case batch, ok := <-handle.Deltas():
				if !ok {
					return
				}
				typ := TypeDelta
				if !synced && len(batch) > 0 && batch[0].Obj != nil && batch[0].Key != "" && batch[0].Op == OpAdd {
					typ = TypeItems
				}
				rv := ""
				if len(batch) > 0 && batch[len(batch)-1].Obj != nil {
					rv = ObjectRV(batch[len(batch)-1].Obj)
				}
				if err := writer.sendData(&DataFrame{Type: typ, ID: frame.ID, RV: rv, Ops: batch}); err != nil {
					return
				}
			}
		}
	}()
}
