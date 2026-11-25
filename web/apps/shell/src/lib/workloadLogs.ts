// Backlog 59: which of a workload's pods the merged log view follows.
import { matchesQuery, parseQuery } from "./filterQuery";
import type { PodRow } from "./pods";

/** Pods followed at once. Every pod is its own log stream, so there is a ceiling. */
export const MAX_LOG_PODS = 20;

/** Running pods first, then by name, cut to the cap; `total` is how many the workload has. */
export function pickLogPods(rows: readonly PodRow[]): { pods: PodRow[]; total: number } {
  const sorted = [...rows].sort(
    (a, b) => Number(b.status === "running") - Number(a.status === "running") || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return { pods: sorted.slice(0, MAX_LOG_PODS), total: rows.length };
}

/** The pod picker's filter: the table's name filter, so "name" and =name mean the whole name. */
export function logPodMatches(name: string, query: string): boolean {
  return matchesQuery({ text: [name], fields: { name } }, parseQuery(query));
}
