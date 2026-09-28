/**
 * Bounds how many clusters' worth of full-mode subscriptions the Fleet
 * dashboard (backlog #15) opens at once. Mounting Phase 1 with, say, 5
 * connected clusters would otherwise open up to 30 concurrent full-mode
 * watches against 5 separate — possibly remote, possibly slow — API
 * servers in the same tick. Clusters are grouped into waves of
 * `concurrency`; each wave after the first waits one more `intervalMs`
 * before its subscriptions enable.
 */
export function staggerDelay(index: number, concurrency: number, intervalMs: number): number {
  const wave = Math.floor(index / concurrency);
  return wave * intervalMs;
}
