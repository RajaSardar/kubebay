package stream

import (
	"sync"
	"sync/atomic"
	"time"
)

type Coalescer struct {
	mu      sync.Mutex
	pending []Op
	index   map[string]int
	out     chan []Op
	closed  chan struct{}
	// kick tells Run that ops arrived in an empty batch.
	kick chan struct{}
	// wakes counts the times Run woke up to flush, so tests can see it idle.
	wakes atomic.Int64
}

func NewCoalescer() *Coalescer {
	return &Coalescer{
		index:  make(map[string]int),
		out:    make(chan []Op, 64),
		closed: make(chan struct{}),
		kick:   make(chan struct{}, 1),
	}
}

func (c *Coalescer) Push(op Op) bool {
	select {
	case <-c.closed:
		return false
	default:
	}
	c.mu.Lock()
	first := len(c.pending) == 0
	if i, ok := c.index[op.Key]; ok && op.Op != OpDelete {
		op.Op = OpModify
		c.pending[i] = op
	} else if ok {
		c.pending[i] = op
	} else {
		c.index[op.Key] = len(c.pending)
		c.pending = append(c.pending, op)
	}
	c.mu.Unlock()
	if first {
		select {
		case c.kick <- struct{}{}:
		default: // Run already knows
		}
	}
	return true
}

func (c *Coalescer) Out() <-chan []Op { return c.out }

func (c *Coalescer) Close() {
	close(c.closed)
}

// Run sends what Push gathered once per flushEvery, starting when the first op
// of a batch arrives. With nothing pending it sleeps: a ticker here would wake
// every open subscription 60 times a second for nothing.
func (c *Coalescer) Run(flushEvery time.Duration) {
	t := time.NewTimer(flushEvery)
	t.Stop()
	defer t.Stop()
	armed := false
	for {
		select {
		case <-c.kick:
			if !armed {
				t.Reset(flushEvery)
				armed = true
			}
		case <-t.C:
			armed = false
			c.wakes.Add(1)
			c.flush()
		case <-c.closed:
			c.flush()
			close(c.out)
			return
		}
	}
}

func (c *Coalescer) flush() {
	c.mu.Lock()
	if len(c.pending) == 0 {
		c.mu.Unlock()
		return
	}
	batch := c.pending
	c.pending = nil
	c.index = make(map[string]int)
	c.mu.Unlock()
	select {
	case c.out <- batch:
	case <-c.closed:
	}
}
