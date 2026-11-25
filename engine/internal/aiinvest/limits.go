package aiinvest

import "time"

// Limits bound one run.
type Limits struct {
	// Wall is the time limit; the run token expires with it.
	Wall time.Duration
	// MaxOutput caps the assistant text forwarded, in bytes.
	MaxOutput int
	// Grace is how long SIGTERM gets before SIGKILL.
	Grace time.Duration
}

// DefaultLimits: 5 minutes, 256 KiB, 3 s grace. One run per user at a time.
func DefaultLimits() Limits {
	return Limits{Wall: 5 * time.Minute, MaxOutput: 256 << 10, Grace: 3 * time.Second}
}
