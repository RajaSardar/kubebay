package stream

import (
	"errors"
	"io"
	"sync"
)

// stdinQueueDepth is generous enough for fast human typing and pasted blocks,
// small enough that a wedged terminal cannot pin much memory.
const stdinQueueDepth = 256

var errStdinQueueFull = errors.New("stdin queue full, input dropped")

// stdinQueue decouples the single WebSocket read loop from a stdin sink that
// can block forever.  A local PTY whose buffer is full (the shell is stopped,
// or ^S'd) would otherwise block the Write in Hub.Handle's read loop, and with
// it every watch subscription and every other terminal on the same socket.
// Overflow drops input rather than blocking: losing keystrokes typed at an
// unresponsive shell beats freezing the whole connection.
type stdinQueue struct {
	ch  chan []byte
	dst io.WriteCloser

	mu     sync.Mutex
	closed bool
}

func newStdinQueue(dst io.WriteCloser, depth int) *stdinQueue {
	q := &stdinQueue{ch: make(chan []byte, depth), dst: dst}
	go q.drain()
	return q
}

func (q *stdinQueue) drain() {
	defer func() { _ = q.dst.Close() }()
	for b := range q.ch {
		if _, err := q.dst.Write(b); err != nil {
			// Keep draining so producers never block; the channel is closed by Close.
			for range q.ch {
			}
			return
		}
	}
}

func (q *stdinQueue) Write(p []byte) (int, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return 0, io.ErrClosedPipe
	}
	b := make([]byte, len(p))
	copy(b, p)
	select {
	case q.ch <- b:
		return len(p), nil
	default:
		return 0, errStdinQueueFull
	}
}

func (q *stdinQueue) Close() error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return nil
	}
	q.closed = true
	close(q.ch)
	return nil
}
