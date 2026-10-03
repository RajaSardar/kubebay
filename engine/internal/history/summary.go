package history

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// SummaryPoint is one bucket of the cluster total: the highest hourly peak
// and the highest request total seen in it. Nil when no hour in the bucket
// was recorded.
type SummaryPoint struct {
	T            time.Time `json:"t"`
	CPUMax       *float64  `json:"cpuMax"`
	MemMax       *float64  `json:"memMax"`
	ReqCPUMillis *int64    `json:"reqCpuMillis"`
	ReqMemBytes  *int64    `json:"reqMemBytes"`
}

// Summary is a coarse, cluster-total view for list pages: a sparkline's
// worth of buckets plus the last known capacity. Capacity is zero when no
// recorded hour had a node count (RBAC without node list, or older data).
type Summary struct {
	Points         []SummaryPoint `json:"points"`
	LastSample     *time.Time     `json:"lastSample"`
	AllocCPUMillis int64          `json:"allocCpuMillis"`
	AllocMemBytes  int64          `json:"allocMemBytes"`
	Nodes          int            `json:"nodes"`
}

// Summary folds the cluster total over [from, to) into bucket-wide points,
// aligned to UTC multiples of bucket so repeated calls line up.
func (s *Store) Summary(fp string, from, to time.Time, bucket time.Duration) Summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	from, to = from.UTC().Truncate(bucket), to.UTC()
	lines := s.readRange(fp, from, to)
	out := Summary{Points: []SummaryPoint{}}
	var capHour time.Time
	for b := from; b.Before(to); b = b.Add(bucket) {
		p := SummaryPoint{T: b}
		for h := b; h.Before(b.Add(bucket)) && h.Before(to); h = h.Add(time.Hour) {
			l, ok := lines[h][""]
			if !ok {
				continue
			}
			if l.N > 0 && (out.LastSample == nil || h.After(*out.LastSample)) {
				hh := h
				out.LastSample = &hh
			}
			if l.ND > 0 && !h.Before(capHour) {
				capHour = h
				out.AllocCPUMillis, out.AllocMemBytes, out.Nodes = l.AC, l.AM, l.ND
			}
			p.CPUMax = maxPtr(p.CPUMax, l.CX)
			p.MemMax = maxPtr(p.MemMax, l.MX)
			p.ReqCPUMillis = maxIntPtr(p.ReqCPUMillis, l.RC)
			p.ReqMemBytes = maxIntPtr(p.ReqMemBytes, l.RM)
		}
		out.Points = append(out.Points, p)
	}
	return out
}

func maxPtr(cur, v *float64) *float64 {
	if v == nil {
		return cur
	}
	if cur == nil || *v > *cur {
		x := *v
		return &x
	}
	return cur
}

func maxIntPtr(cur *int64, v int64) *int64 {
	if cur == nil || v > *cur {
		return &v
	}
	return cur
}

// AllFingerprints maps every cluster with recorded history to its directory:
// the one recorded this session, else the most recently written on disk.
func (r *Recorder) AllFingerprints() map[string]string {
	out := r.store.fingerprintsOnDisk()
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, fp := range r.fps {
		out[id] = fp
	}
	return out
}

func (s *Store) fingerprintsOnDisk() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]string{}
	best := map[string]time.Time{}
	dirs, err := os.ReadDir(s.dir)
	if err != nil {
		return out
	}
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.dir, d.Name(), metaFile))
		if err != nil {
			continue
		}
		var m Meta
		if json.Unmarshal(b, &m) != nil || m.ClusterID == "" {
			continue
		}
		var hour time.Time
		if c := s.load(d.Name()); c.open != nil {
			hour = c.open.Hour
		}
		if _, seen := out[m.ClusterID]; !seen || hour.After(best[m.ClusterID]) {
			out[m.ClusterID], best[m.ClusterID] = d.Name(), hour
		}
	}
	return out
}
