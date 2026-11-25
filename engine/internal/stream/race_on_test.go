//go:build race

package stream

// raceEnabled: the race detector empties sync.Pools at random, so pooled
// allocation budgets only hold in normal builds.
const raceEnabled = true
