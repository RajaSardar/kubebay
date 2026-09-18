package stream

import (
	"errors"
	"testing"
	"time"
)

// blockingWriter stands in for a PTY whose buffer is full because the shell is
// stopped: writes never return.
type blockingWriter struct{ release chan struct{} }

func (b *blockingWriter) Write(p []byte) (int, error) {
	<-b.release
	return len(p), nil
}

func (b *blockingWriter) Close() error { close(b.release); return nil }

func TestStdinQueueDropsRatherThanBlocks(t *testing.T) {
	dst := &blockingWriter{release: make(chan struct{})}
	q := newStdinQueue(dst, 4)

	done := make(chan error, 1)
	go func() {
		// One write is consumed by the drain goroutine and blocks there; the
		// rest fill the queue.  Nothing here may block the caller.
		var last error
		for i := 0; i < 64; i++ {
			_, last = q.Write([]byte("x"))
		}
		done <- last
	}()

	select {
	case err := <-done:
		if !errors.Is(err, errStdinQueueFull) {
			t.Fatalf("overflow error = %v, want errStdinQueueFull", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("stdin writes blocked on a stalled sink — the WebSocket read loop would be frozen")
	}

	_ = q.Close()
	if _, err := q.Write([]byte("x")); err == nil {
		t.Fatal("write after close should fail, not panic")
	}
}

func TestStdinQueueDeliversInOrder(t *testing.T) {
	got := make(chan string, 8)
	q := newStdinQueue(writeCloserFunc(func(p []byte) (int, error) {
		got <- string(p)
		return len(p), nil
	}), 8)

	for _, s := range []string{"a", "b", "c"} {
		if _, err := q.Write([]byte(s)); err != nil {
			t.Fatalf("write %q: %v", s, err)
		}
	}
	for _, want := range []string{"a", "b", "c"} {
		select {
		case g := <-got:
			if g != want {
				t.Fatalf("got %q, want %q", g, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for %q", want)
		}
	}
	_ = q.Close()
}

type writeCloserFunc func([]byte) (int, error)

func (f writeCloserFunc) Write(p []byte) (int, error) { return f(p) }
func (f writeCloserFunc) Close() error                { return nil }
