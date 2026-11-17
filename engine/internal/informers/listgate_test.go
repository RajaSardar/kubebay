package informers

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestListGateCapsConcurrentStarts(t *testing.T) {
	g := newListGate(3)
	stop := make(chan struct{})
	var running, peak atomic.Int32
	done := make(chan struct{})
	for i := 0; i < 10; i++ {
		go func() {
			rel, ok := g.acquire(stop)
			if !ok {
				return
			}
			n := running.Add(1)
			for {
				p := peak.Load()
				if n <= p || peak.CompareAndSwap(p, n) {
					break
				}
			}
			time.Sleep(20 * time.Millisecond)
			running.Add(-1)
			rel()
			done <- struct{}{}
		}()
	}
	for i := 0; i < 10; i++ {
		<-done
	}
	if p := peak.Load(); p > 3 {
		t.Fatalf("peak concurrent initial lists = %d, want <= 3", p)
	}
}

func TestListGateAcquireAbortsOnStop(t *testing.T) {
	g := newListGate(1)
	rel, _ := g.acquire(make(chan struct{}))
	defer rel()
	stop := make(chan struct{})
	res := make(chan bool)
	go func() { _, ok := g.acquire(stop); res <- ok }()
	close(stop)
	select {
	case ok := <-res:
		if ok {
			t.Fatal("acquire succeeded after stop")
		}
	case <-time.After(time.Second):
		t.Fatal("acquire did not return on stop")
	}
}

func TestListGateHoldReleasesOnSyncOrTimeout(t *testing.T) {
	g := newListGate(1)
	stop := make(chan struct{})
	rel, _ := g.acquire(stop)
	var synced atomic.Bool
	finished := make(chan struct{})
	go func() { holdUntilSynced(rel, synced.Load, stop, time.Second); close(finished) }()
	synced.Store(true)
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("slot not released after sync")
	}
	// A cluster that never syncs must not hold a slot past the timeout.
	rel2, _ := g.acquire(stop)
	start := time.Now()
	holdUntilSynced(rel2, func() bool { return false }, stop, 50*time.Millisecond)
	if time.Since(start) > time.Second {
		t.Fatal("hold ignored its timeout")
	}
	if _, ok := g.acquire(stop); !ok {
		t.Fatal("slot not free after timeout")
	}
}
