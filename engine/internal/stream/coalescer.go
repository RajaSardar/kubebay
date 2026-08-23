package stream

import (
	"sync"
	"time"
)

type Coalescer struct {
	mu      sync.Mutex
	pending []Op
	index   map[string]int
	out     chan []Op
	closed  chan struct{}
}

func NewCoalescer() *Coalescer {
	return &Coalescer{
		index:  make(map[string]int),
		out:    make(chan []Op, 64),
		closed: make(chan struct{}),
	}
}

func (c *Coalescer) Push(op Op) bool {
	select {
	case <-c.closed:
		return false
	default:
	}
	c.mu.Lock()
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
	return true
}

func (c *Coalescer) Out() <-chan []Op { return c.out }

func (c *Coalescer) Close() {
	close(c.closed)
}

func (c *Coalescer) Run(flushEvery time.Duration) {
	t := time.NewTicker(flushEvery)
	defer t.Stop()
	for {
		select {
		case <-t.C:
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
