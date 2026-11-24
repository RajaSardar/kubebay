package timeline

import (
	"testing"
	"time"
)

func span(ns string, from, to int, reason string) Span {
	return Span{Cluster: "c", Kind: "Pod", Namespace: ns, Start: t0.Add(time.Duration(from) * time.Minute), End: t0.Add(time.Duration(to) * time.Minute), Reason: reason}
}

func at(min int) time.Time { return t0.Add(time.Duration(min) * time.Minute) }

func TestGapsWithNoSpansIsOneNotRecordedBand(t *testing.T) {
	g := Gaps(nil, at(0), at(60), 0)
	if len(g) != 1 || !g[0].From.Equal(at(0)) || !g[0].To.Equal(at(60)) || g[0].Reason != ReasonNotRecorded {
		t.Errorf("%+v", g)
	}
}

func TestGapsAroundASpan(t *testing.T) {
	g := Gaps([]Span{span("", 20, 40, "watch stopped")}, at(0), at(60), 0)
	if len(g) != 2 {
		t.Fatalf("%+v", g)
	}
	if !g[0].To.Equal(at(20)) || g[0].Reason != ReasonNotRecorded {
		t.Errorf("leading gap: %+v", g[0])
	}
	if !g[1].From.Equal(at(40)) || g[1].Reason != "watch stopped" {
		t.Errorf("trailing gap takes the closing reason: %+v", g[1])
	}
}

func TestGapsAnUnclosedSpanMeansTheAppStopped(t *testing.T) {
	g := Gaps([]Span{span("", 0, 10, "")}, at(0), at(60), 0)
	if len(g) != 1 || g[0].Reason != ReasonNotRunning {
		t.Errorf("%+v", g)
	}
}

func TestGapsMergeOverlapsAndAdjacentSpans(t *testing.T) {
	g := Gaps([]Span{span("", 30, 50, ""), span("", 0, 20, ""), span("", 15, 32, "")}, at(0), at(50), 0)
	if len(g) != 0 {
		t.Errorf("overlapping spans left a gap: %+v", g)
	}
}

func TestGapsClipToTheWindow(t *testing.T) {
	g := Gaps([]Span{span("", -100, 10, "x"), span("", 50, 500, "")}, at(0), at(60), 0)
	if len(g) != 1 || !g[0].From.Equal(at(10)) || !g[0].To.Equal(at(50)) {
		t.Errorf("%+v", g)
	}
	if got := Gaps(nil, at(10), at(10), 0); len(got) != 0 {
		t.Errorf("empty window: %+v", got)
	}
}

func TestGapsIgnoreShortHolesWithinSlack(t *testing.T) {
	g := Gaps([]Span{span("", 0, 10, ""), span("", 10, 60, "")}, at(0), at(60), time.Minute)
	if len(g) != 0 {
		t.Errorf("%+v", g)
	}
	spans := []Span{span("", 0, 10, "stopped"), {Cluster: "c", Kind: "Pod", Start: at(10).Add(20 * time.Second), End: at(60)}}
	if g := Gaps(spans, at(0), at(60), time.Minute); len(g) != 0 {
		t.Errorf("a 20 s hole under a 1 min slack is shown: %+v", g)
	}
	if g := Gaps(spans, at(0), at(60), 5*time.Second); len(g) != 1 {
		t.Errorf("a 20 s hole over a 5 s slack is hidden: %+v", g)
	}
}

func TestSpansForNamespace(t *testing.T) {
	spans := []Span{span("", 0, 10, ""), span("web", 10, 20, ""), span("db", 20, 30, "")}
	if got := SpansFor(spans, ""); len(got) != 1 {
		t.Errorf("an all-namespaces view counts only all-namespace watches: %+v", got)
	}
	if got := SpansFor(spans, "web"); len(got) != 2 {
		t.Errorf("a namespace view counts its own and the all-namespace watches: %+v", got)
	}
}
