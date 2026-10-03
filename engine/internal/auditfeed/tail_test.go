package auditfeed

import (
	"bytes"
	"io"
	"strings"
	"testing"
	"testing/iotest"
)

// Reviewer-measured regression: compacting on every 64 KiB chunk once past
// the budget re-copied the whole window each time (3.65 s for a 100 MiB
// rotation). Compactions must stay proportional to size/budget.
func TestKeepTailCompactsRarelyAndKeepsTheNewestBytes(t *testing.T) {
	const budget = 256 << 10
	var src bytes.Buffer
	for i := 0; src.Len() < 8<<20; i++ {
		src.WriteString(strings.Repeat("x", 100))
		src.WriteByte('\n')
	}
	data := src.Bytes()

	buf, cut, moved, err := keepTail(bytes.NewReader(data), budget)
	if err != nil {
		t.Fatal(err)
	}
	if !cut || len(buf) != budget || !bytes.Equal(buf, data[len(data)-budget:]) {
		t.Fatalf("kept %d bytes (cut=%v), want exactly the newest %d", len(buf), cut, budget)
	}
	// 8 MiB through a 256 KiB window: the kept window may be re-copied about
	// once, not once per 64 KiB chunk (that was ~31 MiB of memmove here).
	if moved > 2*budget {
		t.Errorf("re-copied %d bytes after reading, want at most %d", moved, 2*budget)
	}

	small, cut, _, _ := keepTail(bytes.NewReader([]byte("a\nb\n")), budget)
	if cut || string(small) != "a\nb\n" {
		t.Errorf("a stream under budget is kept whole: %q cut=%v", small, cut)
	}
}

func TestKeepTailIsExactAtEveryWrapPoint(t *testing.T) {
	data := make([]byte, 10_000)
	for i := range data {
		data[i] = byte(i % 251)
	}
	for _, budget := range []int64{1, 7, 999, 4096, 9_999, 10_000, 20_000} {
		for _, chunked := range []bool{false, true} {
			var r io.Reader = bytes.NewReader(data)
			if chunked {
				r = iotest.OneByteReader(r)
			}
			got, cut, _, err := keepTail(r, budget)
			want := data
			if int64(len(data)) > budget {
				want = data[int64(len(data))-budget:]
			}
			if err != nil || !bytes.Equal(got, want) || cut != (int64(len(data)) > budget) {
				t.Errorf("budget %d chunked=%v: got %d bytes cut=%v err=%v", budget, chunked, len(got), cut, err)
			}
		}
	}
}
