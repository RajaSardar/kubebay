package stream

import (
	"testing"
	"time"
)

func TestCoalescerLatestWins(t *testing.T) {
	c := NewCoalescer()
	go c.Run(10 * time.Millisecond)

	c.Push(Op{Op: OpAdd, Key: "a", Obj: map[string]any{"v": 1}})
	c.Push(Op{Op: OpModify, Key: "a", Obj: map[string]any{"v": 2}})
	c.Push(Op{Op: OpAdd, Key: "b", Obj: map[string]any{"v": 1}})

	select {
	case batch := <-c.Out():
		if len(batch) != 2 {
			t.Fatalf("want 2 coalesced ops, got %d: %+v", len(batch), batch)
		}
		if batch[0].Key != "a" || batch[0].Obj["v"] != float64(2) && batch[0].Obj["v"] != 2 {
			t.Fatalf("latest value should win for key a: %+v", batch[0])
		}
		if batch[1].Key != "b" {
			t.Fatalf("insertion order should be preserved: %+v", batch)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for flush")
	}
	c.Close()
}

func TestCoalescerAddThenDeleteCollapses(t *testing.T) {
	c := NewCoalescer()
	go c.Run(5 * time.Millisecond)

	c.Push(Op{Op: OpAdd, Key: "x"})
	c.Push(Op{Op: OpDelete, Key: "x"})

	select {
	case batch := <-c.Out():
		if len(batch) != 1 || batch[0].Op != OpDelete || batch[0].Key != "x" {
			t.Fatalf("add+delete should collapse to a single delete (latest state wins): %+v", batch)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout")
	}
	c.Close()
}
