package stream

import "testing"

// One 16 ms flush of 7 pod updates: the key index is reused, not rebuilt.
func TestCoalescerFlushAllocationBudget(t *testing.T) {
	c := NewCoalescer()
	ops := podOps(7)
	cycle := func() {
		for _, o := range ops {
			c.Push(o)
		}
		c.flush()
		<-c.out
	}
	cycle()
	n := testing.AllocsPerRun(200, cycle)
	t.Logf("push 7 + flush: %.0f allocs (6 when the index was rebuilt)", n)
	if n > 4 {
		t.Errorf("push 7 + flush: %.0f allocs, budget 4", n)
	}
}

// After a burst the coalescer lets go of the burst-sized index and slice.
func TestCoalescerDropsBurstBuffers(t *testing.T) {
	c := NewCoalescer()
	for i := 0; i < 2*reuseBatch; i++ {
		c.Push(Op{Op: OpAdd, Key: itoaTest(i)})
	}
	c.flush()
	<-c.out
	if cap(c.pending) != 0 || len(c.index) != 0 {
		t.Fatalf("kept pending cap %d, index %d after a burst", cap(c.pending), len(c.index))
	}
}

func itoaTest(i int) string {
	b := []byte{}
	for {
		b = append([]byte{byte('0' + i%10)}, b...)
		if i /= 10; i == 0 {
			return string(b)
		}
	}
}
