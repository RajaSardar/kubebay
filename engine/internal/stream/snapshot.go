package stream

import "iter"

// Snapshot is a subscription's objects as of its sync. An object becomes an
// op only when it's read, a frame at a time, and the hub writes each frame
// before it builds the next: a 100k-object snapshot is never 100k ops at
// once (KB-02, docs/PERFORMANCE.md).
type Snapshot struct {
	items []any
	op    func(any) (Op, bool)
}

// NewSnapshot is items, each made an op by op when it's read. An item op
// turns down (one without a key, say) is left out.
func NewSnapshot(items []any, op func(any) (Op, bool)) Snapshot {
	return Snapshot{items: items, op: op}
}

// OpsSnapshot is a snapshot of ops already built.
func OpsSnapshot(ops []Op) Snapshot {
	items := make([]any, len(ops))
	for i, o := range ops {
		items[i] = o
	}
	return NewSnapshot(items, func(it any) (Op, bool) { return it.(Op), true })
}

// Len is how many objects the snapshot holds, counting any left out as ops.
func (s Snapshot) Len() int { return len(s.items) }

// Frames yields the snapshot's ops n objects at a time, building each frame's
// only when the one before has been taken.
func (s Snapshot) Frames(n int) iter.Seq[[]Op] {
	return func(yield func([]Op) bool) {
		for i := 0; i < len(s.items); i += n {
			chunk := s.items[i:min(i+n, len(s.items))]
			ops := make([]Op, 0, len(chunk))
			for _, it := range chunk {
				if op, ok := s.op(it); ok {
					ops = append(ops, op)
				}
			}
			if len(ops) > 0 && !yield(ops) {
				return
			}
		}
	}
}

// All builds every op at once, for a caller that wants them together.
func (s Snapshot) All() []Op {
	var out []Op
	for ops := range s.Frames(itemsPerFrame) {
		out = append(out, ops...)
	}
	return out
}
