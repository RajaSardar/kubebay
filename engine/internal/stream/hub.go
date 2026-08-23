package stream

import (
	"context"
	"encoding/binary"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	writeTimeout  = 10 * time.Second
	maxFrameSize  = 16 << 20
	itemsPerFrame = 200
)

type Hub struct {
	log      *slog.Logger
	chandeps ChannelDeps
}

type SubSource interface {
	Subscribe(ctx context.Context, cluster, gvr string, namespaces []string, selector, mode string) (SubHandle, error)
}

type SubHandle interface {
	ID() string
	Snapshot() <-chan []Op
	Deltas() <-chan []Op
}

type TermSize struct {
	Cols uint16
	Rows uint16
}

type ChanSpec struct {
	Kind      string
	Cluster   string
	Namespace string
	Pod       string
	Container string
	Tail      int64
	Follow    bool
	Previous  bool
	Command   []string
	Cols      uint16
	Rows      uint16
}

type ChannelDeps interface {
	OpenLogs(ctx context.Context, spec ChanSpec, write func([]byte) error) error
	OpenExec(ctx context.Context, spec ChanSpec, write func([]byte) error, stdin io.Reader, resize <-chan TermSize) error
}

func NewHub(log *slog.Logger, deps ChannelDeps) *Hub { return &Hub{log: log, chandeps: deps} }

type chanEntry struct {
	cancel context.CancelFunc
	stdin  io.Writer
	resize chan<- TermSize
}

type subTable struct {
	mu sync.Mutex
	m  map[string]context.CancelFunc
}

func newSubTable() *subTable { return &subTable{m: map[string]context.CancelFunc{}} }

func (t *subTable) put(id string, cancel context.CancelFunc) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, exists := t.m[id]; exists {
		return false
	}
	t.m[id] = cancel
	return true
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

func (w *connWriter) write(typ websocket.MessageType, b []byte) error {
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
	return w.write(websocket.MessageText, b)
}

func (w *connWriter) sendData(f *DataFrame) error {
	b, err := EncodeData(f)
	if err != nil {
		return err
	}
	return w.write(websocket.MessageBinary, b)
}

func decodeChanEnvelope(payload []byte) (string, []byte, bool) {
	if len(payload) < 4 {
		return "", nil, false
	}
	n := binary.BigEndian.Uint32(payload[:4])
	if int(n) > len(payload)-4 || n == 0 {
		return "", nil, false
	}
	id := string(payload[4 : 4+n])
	return id, payload[4+n:], true
}

func validChanKind(k string) bool { return k == ChanKindLogs || k == ChanKindExec }

func (h *Hub) Handle(w http.ResponseWriter, r *http.Request, src SubSource) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:*", "127.0.0.1:*", "tauri://localhost", "http://tauri.localhost"},
	})
	if err != nil {
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	c.SetReadLimit(maxFrameSize)

	ctx := r.Context()
	writer := &connWriter{c: c}
	table := newSubTable()
	chans := map[string]*chanEntry{}
	var chanMu sync.Mutex

	closeChan := func(id string, entry *chanEntry) {
		entry.cancel()
		if cw, ok := entry.stdin.(io.Closer); ok {
			_ = cw.Close()
		}
		chanMu.Lock()
		delete(chans, id)
		chanMu.Unlock()
	}
	cleanupAll := func() {
		table.stopAll()
		chanMu.Lock()
		snapshot := make(map[string]*chanEntry, len(chans))
		for id, ch := range chans {
			snapshot[id] = ch
		}
		chans = map[string]*chanEntry{}
		chanMu.Unlock()
		for _, ch := range snapshot {
			ch.cancel()
			if cw, ok := ch.stdin.(io.Closer); ok {
				_ = cw.Close()
			}
		}
	}
	defer cleanupAll()

	for {
		msgType, data, err := c.Read(ctx)
		if err != nil {
			return
		}

		if msgType == websocket.MessageBinary {
			if id, payload, ok := decodeChanEnvelope(data); ok {
				chanMu.Lock()
				ch, exists := chans[id]
				chanMu.Unlock()
				if exists && ch.stdin != nil {
					if _, errw := ch.stdin.Write(payload); errw != nil {
						h.log.Warn("stdin write failed", "chan", id, "err", errw)
					}
				}
			}
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
			if !table.drop(frame.ID) {
				_ = writer.sendControl(ControlFrame{Type: TypeError, ID: frame.ID, Message: "unknown subscription"})
				continue
			}
			_ = writer.sendControl(ControlFrame{Type: TypeAck, ID: frame.ID, Message: "unsubscribed"})

		case TypeResync:
			table.drop(frame.ID)
			h.start(ctx, frame, src, writer, table)

		case TypeSub:
			h.start(ctx, frame, src, writer, table)

		case TypeChanOpen:
			if !validChanKind(frame.Kind) {
				_ = writer.sendControl(ControlFrame{Type: TypeError, ID: frame.ID, Message: "invalid channel kind"})
				continue
			}
			chanMu.Lock()
			_, dup := chans[frame.ID]
			chanMu.Unlock()
			if dup {
				_ = writer.sendControl(ControlFrame{Type: TypeError, ID: frame.ID, Message: "channel id already open"})
				continue
			}

			chCtx, cancel := context.WithCancel(context.Background())
			entry := &chanEntry{cancel: cancel}

			switch frame.Kind {
			case ChanKindExec:
				pr, pw := io.Pipe()
				entry.stdin = pw
				rz := make(chan TermSize, 8)
				entry.resize = rz
				go h.runExec(chCtx, frame, writer, pr, rz, func() { closeChan(frame.ID, entry) })
			default:
				go h.runLogs(chCtx, frame, writer, func() { closeChan(frame.ID, entry) })
			}

			chanMu.Lock()
			chans[frame.ID] = entry
			chanMu.Unlock()
			_ = writer.sendControl(ControlFrame{Type: TypeAck, ID: frame.ID, Message: "channel open"})

		case TypeChanResize:
			chanMu.Lock()
			ch, exists := chans[frame.ID]
			chanMu.Unlock()
			if exists && ch.resize != nil {
				select {
				case ch.resize <- TermSize{Cols: frame.Cols, Rows: frame.Rows}:
				default:
				}
			}

		case TypeChanClose:
			chanMu.Lock()
			ch, exists := chans[frame.ID]
			chanMu.Unlock()
			if exists {
				closeChan(frame.ID, ch)
			}
			_ = writer.sendControl(ControlFrame{Type: TypeAck, ID: frame.ID, Message: "channel closed"})
		}
	}
}

func (h *Hub) runLogs(ctx context.Context, frame *ClientFrame, writer *connWriter, finished func()) {
	defer finished()
	spec := ChanSpec{
		Kind: ChanKindLogs, Cluster: frame.Cluster, Namespace: frame.Namespace,
		Pod: frame.Pod, Container: frame.Container, Tail: frame.Tail,
		Follow: frame.Follow, Previous: frame.Previous,
	}
	write := func(b []byte) error {
		return writer.sendData(&DataFrame{Type: TypeChanData, ID: frame.ID, Data: b})
	}
	err := h.chandeps.OpenLogs(ctx, spec, write)
	msg := "done"
	if err != nil {
		msg = err.Error()
	}
	_ = writer.sendControl(ControlFrame{Type: TypeChanClosed, ID: frame.ID, Message: msg})
}

func (h *Hub) runExec(ctx context.Context, frame *ClientFrame, writer *connWriter, stdin *io.PipeReader, resize chan TermSize, finished func()) {
	defer finished()
	defer stdin.Close()
	spec := ChanSpec{
		Kind: ChanKindExec, Cluster: frame.Cluster, Namespace: frame.Namespace,
		Pod: frame.Pod, Container: frame.Container, Command: frame.Command,
		Cols: frame.Cols, Rows: frame.Rows,
	}
	write := func(b []byte) error {
		return writer.sendData(&DataFrame{Type: TypeChanData, ID: frame.ID, Data: b})
	}
	err := h.chandeps.OpenExec(ctx, spec, write, stdin, resize)
	msg := "done"
	if err != nil {
		msg = err.Error()
	}
	_ = writer.sendControl(ControlFrame{Type: TypeChanClosed, ID: frame.ID, Message: msg})
}

func (h *Hub) start(parent context.Context, frame *ClientFrame, src SubSource, writer *connWriter, table *subTable) {
	subCtx, cancel := context.WithCancel(parent)
	handle, err := src.Subscribe(subCtx, frame.Cluster, frame.GVR, frame.Namespaces, frame.LabelSelector, frame.Mode)
	if err != nil {
		cancel()
		_ = writer.sendControl(ControlFrame{Type: TypeError, ID: frame.ID, Message: err.Error()})
		return
	}
	table.put(frame.ID, cancel)
	_ = writer.sendControl(ControlFrame{Type: TypeAck, ID: frame.ID, Message: "subscribed"})

	go func() {
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
