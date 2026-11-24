/** A resource's labels as sorted `key=value` strings. */
export function labelPairs(labels: Readonly<Record<string, string>> | undefined): string[] {
  return Object.entries(labels ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
}

/** The first `max` labels to draw as chips, and how many more there are. */
export function labelChips(
  labels: Readonly<Record<string, string>> | undefined,
  max: number,
): { shown: string[]; more: number } {
  const all = labelPairs(labels);
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}
