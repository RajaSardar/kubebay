package history

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// Coverage says how much of the retention window a cluster's history covers.
// Consumers must show Label next to anything derived from the series.
type Coverage struct {
	RetentionDays    int        `json:"retentionDays"`
	ExpectedHours    int        `json:"expectedHours"`
	ObservedHours    int        `json:"observedHours"`
	WellSampledHours int        `json:"wellSampledHours"`
	DistinctDays     int        `json:"distinctDays"`
	LongestGapHours  int        `json:"longestGapHours"`
	First            *time.Time `json:"first"`
	// HourOfDayObserved counts well-sampled hours per local hour of day.
	HourOfDayObserved [24]int `json:"hourOfDayObserved"`
	WeekendObserved   bool    `json:"weekendObserved"`
	Label             string  `json:"label"`
}

// coverage is computed from the cluster-total series over the retention window.
func (s *Store) coverage(fp string) Coverage {
	now := s.o.Now().UTC()
	from := now.Truncate(time.Hour).Add(-s.o.Retention + time.Hour)
	hours := map[time.Time]int{}
	for h, byNs := range s.readRange(fp, from, now.Add(time.Hour)) {
		if l, ok := byNs[""]; ok && l.N > 0 {
			hours[h] = l.N
		}
	}
	return coverageFromHours(hours, now, s.o.Retention, s.o.WellSampledN, s.o.Location)
}

// coverageFromHours summarises observed hours (hour start → sample count)
// within the retention window ending at now. Shared by local and Prometheus series.
func coverageFromHours(observed map[time.Time]int, now time.Time, retention time.Duration, wellSampledN int, loc *time.Location) Coverage {
	from := now.UTC().Truncate(time.Hour).Add(-retention + time.Hour)
	cov := Coverage{RetentionDays: int(retention / (24 * time.Hour)), ExpectedHours: int(retention / time.Hour)}
	var hours []time.Time
	days := map[string]bool{}
	for h, n := range observed {
		if n == 0 || h.Before(from) || h.After(now) {
			continue
		}
		hours = append(hours, h)
		cov.ObservedHours++
		if n < wellSampledN {
			continue
		}
		cov.WellSampledHours++
		local := h.In(loc)
		cov.HourOfDayObserved[local.Hour()]++
		days[local.Format("2006-01-02")] = true
		if wd := local.Weekday(); wd == time.Saturday || wd == time.Sunday {
			cov.WeekendObserved = true
		}
	}
	cov.DistinctDays = len(days)
	sort.Slice(hours, func(i, j int) bool { return hours[i].Before(hours[j]) })
	if len(hours) > 0 {
		first := hours[0]
		cov.First = &first
	}
	for i := 1; i < len(hours); i++ {
		if gap := int(hours[i].Sub(hours[i-1])/time.Hour) - 1; gap > cov.LongestGapHours {
			cov.LongestGapHours = gap
		}
	}
	cov.Label = coverageLabel(cov.HourOfDayObserved, cov.WeekendObserved)
	return cov
}

// coverageLabel names the local hours of day that have well-sampled data,
// e.g. "observed 09–18 local, weekdays only".
func coverageLabel(hod [24]int, weekend bool) string {
	var ranges []string
	covered := 0
	for h := 0; h < 24; {
		if hod[h] == 0 {
			h++
			continue
		}
		start := h
		for h < 24 && hod[h] > 0 {
			h++
		}
		covered += h - start
		ranges = append(ranges, fmt.Sprintf("%02d–%02d", start, h))
	}
	suffix := ""
	if !weekend {
		suffix = ", weekdays only"
	}
	switch {
	case covered == 0:
		return "no well-sampled hours yet"
	case covered == 24:
		return "round-the-clock" + suffix
	default:
		return "observed " + strings.Join(ranges, ", ") + " local" + suffix
	}
}
