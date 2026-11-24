package timeline

import (
	"sort"
	"time"
)

// Gap reasons.
const (
	ReasonNotRecorded = "not recorded"
	ReasonNotRunning  = "the app was not running or the watch was not open"
)

// SpansFor keeps the spans that answer for namespace: with no namespace, only
// watches over every namespace (a watch of one namespace says nothing about
// the rest); with one, its own watches and the all-namespace ones.
func SpansFor(spans []Span, namespace string) []Span {
	var out []Span
	for _, s := range spans {
		if s.Namespace == "" || s.Namespace == namespace {
			out = append(out, s)
		}
	}
	return out
}

// Gaps is the parts of [from, to] no span covers, as "not recorded" bands.
// Spans may overlap or come in any order. A hole shorter than slack is not
// a gap: a watch that restarts, or a heartbeat that has not yet moved, is not
// a period anyone missed. A gap after a span takes the reason that span
// closed with; an unclosed span (the app stopped without closing it) says so.
func Gaps(spans []Span, from, to time.Time, slack time.Duration) []Gap {
	if !from.Before(to) {
		return nil
	}
	sorted := append([]Span(nil), spans...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Start.Before(sorted[j].Start) })
	var out []Gap
	add := func(a, b time.Time, reason string) {
		if b.Sub(a) > slack && b.After(a) {
			out = append(out, Gap{From: a, To: b, Reason: reason})
		}
	}
	cursor, reason := from, ReasonNotRecorded
	for _, s := range sorted {
		if !s.End.After(cursor) {
			continue
		}
		if s.Start.After(to) || s.Start.Equal(to) {
			break
		}
		add(cursor, minTime(s.Start, to), reason)
		cursor = s.End
		reason = s.Reason
		if reason == "" {
			reason = ReasonNotRunning
		}
		if !cursor.Before(to) {
			return out
		}
	}
	add(cursor, to, reason)
	return out
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
