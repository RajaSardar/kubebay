package timeline

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

var errNoCluster = errors.New("timeline: a query needs a cluster")

// limitOf clamps a page size.
func limitOf(n int) int {
	switch {
	case n <= 0:
		return DefaultQueryLimit
	case n > MaxQueryLimit:
		return MaxQueryLimit
	}
	return n
}

// cursor is the (ts, id) of the last row of a page, so equal timestamps
// still page without a gap or a repeat.
type cursor struct {
	ms int64
	id int64
}

func (c cursor) String() string { return fmt.Sprintf("%d:%d", c.ms, c.id) }

func parseCursor(s string) (cursor, bool, error) {
	if s == "" {
		return cursor{}, false, nil
	}
	a, b, ok := strings.Cut(s, ":")
	if !ok {
		return cursor{}, false, errors.New("timeline: bad cursor")
	}
	ms, err1 := strconv.ParseInt(a, 10, 64)
	id, err2 := strconv.ParseInt(b, 10, 64)
	if err1 != nil || err2 != nil {
		return cursor{}, false, errors.New("timeline: bad cursor")
	}
	return cursor{ms, id}, true, nil
}
