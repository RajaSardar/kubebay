package informers

import (
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// fanOutOne emits one update to an entry with n subscriptions and returns
// the op each subscription's coalescer received.
func fanOutOne(t *testing.T, n int) []stream.Op {
	t.Helper()
	e := &entry{fanout: make(chan stream.Op, 1), subs: map[*Subscription]struct{}{}}
	var subs []*Subscription
	for i := 0; i < n; i++ {
		s := &Subscription{Coal: stream.NewCoalescer()}
		go s.Coal.Run(time.Millisecond)
		t.Cleanup(s.Coal.Close)
		e.subs[s] = struct{}{}
		subs = append(subs, s)
	}
	go (&Pool{}).drainFanout(e)
	e.emit(stream.OpModify, &unstructured.Unstructured{Object: map[string]any{
		"metadata": map[string]any{"namespace": "shop", "name": "api"},
	}})
	close(e.fanout)
	var got []stream.Op
	for _, s := range subs {
		select {
		case batch := <-s.Coal.Out():
			if len(batch) != 1 || batch[0].Key != "shop/api" || batch[0].Op != stream.OpModify {
				t.Fatalf("batch = %+v", batch)
			}
			got = append(got, batch[0])
		case <-time.After(5 * time.Second):
			t.Fatal("no batch reached the subscription")
		}
	}
	return got
}

// A delta going to several subscriptions is copies of one op carrying a
// shared encoding, so the object is encoded once for all of them.
func TestFanoutToSeveralSubscriptionsSharesTheEncoding(t *testing.T) {
	for _, op := range fanOutOne(t, 3) {
		if !op.Shared() {
			t.Fatal("an op fanned out to 3 subscriptions does not share its encoding")
		}
	}
}

// With one subscription there is nothing to share: the op stays plain and is
// written straight into the pooled frame buffer, with no separate encoding
// of the object (16.5 KB per update for a shared op, about 0 for a plain one).
func TestFanoutToOneSubscriptionStaysPlain(t *testing.T) {
	if op := fanOutOne(t, 1)[0]; op.Shared() {
		t.Fatal("an op going to a single subscription was given a shared encoding it cannot reuse")
	}
}
