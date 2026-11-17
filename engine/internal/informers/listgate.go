package informers

import "time"

// maxInitialLists is how many informers, across every cluster, may be doing
// their first LIST at once. Connecting many clusters (or waking from sleep
// with several warm) would otherwise start every LIST in the same instant.
const maxInitialLists = 3

// listHoldMax bounds how long one informer holds a slot, so a cluster that
// never syncs (unreachable, slow) cannot starve the others.
const listHoldMax = 30 * time.Second

var initialLists = newListGate(maxInitialLists)

// listGate is a counting semaphore for starting informers.
type listGate struct{ slots chan struct{} }

func newListGate(n int) *listGate { return &listGate{slots: make(chan struct{}, n)} }

// acquire waits for a slot. It returns false if stop closes first.
func (g *listGate) acquire(stop <-chan struct{}) (release func(), ok bool) {
	select {
	case g.slots <- struct{}{}:
		return func() { <-g.slots }, true
	case <-stop:
		return nil, false
	}
}

// holdUntilSynced keeps the slot until synced reports true, stop closes or
// max passes, then releases it.
func holdUntilSynced(release func(), synced func() bool, stop <-chan struct{}, max time.Duration) {
	defer release()
	deadline := time.NewTimer(max)
	defer deadline.Stop()
	tick := time.NewTicker(25 * time.Millisecond)
	defer tick.Stop()
	for !synced() {
		select {
		case <-stop:
			return
		case <-deadline.C:
			return
		case <-tick.C:
		}
	}
}
