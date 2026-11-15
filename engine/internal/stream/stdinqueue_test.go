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

	type result struct{ ok, full int }
	done := make(chan result, 1)
	go func() {
		// The drain goroutine takes one write and blocks on the sink; the
		// queue holds four more; everything else must be dropped, and nothing
		// here may block the caller. When the drain goroutine first runs is up
		// to the scheduler, so the one write it frees room for can land
		// anywhere in the loop, even last: count outcomes, not the final one.
		var r result
		for i := 0; i < 64; i++ {
			_, err := q.Write([]byte("x"))
			switch {
			case err == nil:
				r.ok++
			case errors.Is(err, errStdinQueueFull):
				r.full++
			default:
				t.Errorf("write %d: unexpected error %v", i, err)
			}
		}
		done <- r
	}()

	select {
	case r := <-done:
		if r.full == 0 || r.ok > 5 || r.ok+r.full != 64 {
			t.Fatalf("accepted %d, dropped %d: want at most depth+1 (5) accepted and the rest dropped with errStdinQueueFull", r.ok, r.full)
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
