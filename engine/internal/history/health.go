package history

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// Health history (Overview v2's 7-day chip): which workloads were broken in
// which recorded hours. When an hour closes, every workload broken in at least
// one of its ticks gets one line in that day's .health.jsonl, worst first, up
// to MaxHealthLines; past the cap one overflow line marks the hour, so it is
// left out for any workload it does not list instead of reading as clean.
// Healthy workloads write nothing: an hour the cluster was recorded with no
// line for a workload is a clean hour for it.

const healthVersion = 1

type healthLine struct {
	V        int       `json:"v"`
	H        time.Time `json:"h"`
	W        string    `json:"w,omitempty"`
	B        int       `json:"b,omitempty"`
	Overflow bool      `json:"overflow,omitempty"`
}

// WorkloadHealth is one workload's record over a window: recorded hours (the
// cluster was being recorded) and how many of them it was broken in.
type WorkloadHealth struct {
	RecordedHours int `json:"recordedHours"`
	BrokenHours   int `json:"brokenHours"`
	RecordedDays  int `json:"recordedDays"`
	BrokenDays    int `json:"brokenDays"`
}

// brokenTicksFor is how many broken ticks make an hour broken: five minutes'
// worth, as the Overview's grace period, or half the ticks of a short hour.
func brokenTicksFor(n int) int {
	return max(1, min(5, (n+1)/2))
}

func healthFile(cdir string, hour time.Time) string {
	return filepath.Join(cdir, hour.UTC().Format("2006-01-02")+".health.jsonl")
}

func (s *Store) flushHealth(cdir string, oh *openHour) error {
	if len(oh.Health) == 0 {
		return nil
	}
	ws := make([]string, 0, len(oh.Health))
	for w := range oh.Health {
		ws = append(ws, w)
	}
	sort.Slice(ws, func(i, j int) bool {
		if oh.Health[ws[i]] != oh.Health[ws[j]] {
			return oh.Health[ws[i]] > oh.Health[ws[j]]
		}
		return ws[i] < ws[j]
	})
	fh, err := os.OpenFile(healthFile(cdir, oh.Hour), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer fh.Close()
	bw := bufio.NewWriter(fh)
	write := func(l healthLine) {
		b, _ := json.Marshal(l)
		_, _ = bw.Write(append(b, '\n'))
	}
	for i, w := range ws {
		if i == s.o.MaxHealthLines {
			write(healthLine{V: healthVersion, H: oh.Hour, Overflow: true})
			break
		}
		write(healthLine{V: healthVersion, H: oh.Hour, W: w, B: oh.Health[w]})
	}
	return bw.Flush()
}

type healthHour struct {
	byW      map[string]int
	overflow bool
}

// readHealth returns the health lines for fp in [from, to), keyed by hour,
// overlaid with the open hour.
func (s *Store) readHealth(fp string, from, to time.Time) map[time.Time]*healthHour {
	out := map[time.Time]*healthHour{}
	at := func(h time.Time) *healthHour {
		if out[h] == nil {
			out[h] = &healthHour{byW: map[string]int{}}
		}
		return out[h]
	}
	cdir := filepath.Join(s.dir, fp)
	for d := from.UTC().Truncate(24 * time.Hour); d.Before(to); d = d.Add(24 * time.Hour) {
		fh, err := os.Open(healthFile(cdir, d))
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(fh)
		for sc.Scan() {
			var l healthLine
			if json.Unmarshal(sc.Bytes(), &l) != nil || l.V != healthVersion || l.H.Before(from) || !l.H.Before(to) {
				continue
			}
			if l.Overflow {
				at(l.H).overflow = true
			} else {
				at(l.H).byW[l.W] = l.B
			}
		}
		_ = fh.Close()
	}
	if c := s.load(fp); c.open != nil && !c.open.Hour.Before(from) && c.open.Hour.Before(to) {
		for w, b := range c.open.Health {
			at(c.open.Hour).byW[w] = b
		}
	}
	return out
}

// Health reports workload w ("namespace/Kind/name") over the recorded hours
// in [from, to). Days are counted in the store's Location.
func (s *Store) Health(fp, w string, from, to time.Time) (WorkloadHealth, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	from, to = from.UTC().Truncate(time.Hour), to.UTC()
	health := s.readHealth(fp, from, to)
	var out WorkloadHealth
	days, brokenDays := map[string]bool{}, map[string]bool{}
	for h, byNs := range s.readRange(fp, from, to) {
		l, ok := byNs[""]
		if !ok || l.N == 0 {
			continue
		}
		b := 0
		if hh := health[h]; hh != nil {
			var listed bool
			b, listed = hh.byW[w]
			if hh.overflow && !listed {
				continue
			}
		}
		day := h.In(s.o.Location).Format("2006-01-02")
		out.RecordedHours++
		days[day] = true
		if b >= brokenTicksFor(l.N) {
			out.BrokenHours++
			brokenDays[day] = true
		}
	}
	out.RecordedDays, out.BrokenDays = len(days), len(brokenDays)
	return out, nil
}
