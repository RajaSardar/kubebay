import type { StatusTone } from "@kubebay/ui";
import type { ClusterInfo, FleetSummary } from "./api";

/** The engine answers at most this many clusters per request. */
export const MAX_SUMMARY_IDS = 200;

/**
 * The clusters the picker asks a summary for: the ones it shows that are not
 * connected (those have live data) and can build a client at all.
 */
export function summaryTargets(shown: ClusterInfo[], isConnected: (c: ClusterInfo) => boolean): string[] {
  return shown
    .filter((c) => c.status !== "misconfigured" && !isConnected(c))
    .slice(0, MAX_SUMMARY_IDS)
    .map((c) => c.id);
}

export type FleetNodes = { pending: true } | { text: string; tone?: StatusTone; title: string };

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** What the Nodes column shows for a summarised cluster; null with no summary. */
export function fleetNodes(s: FleetSummary | undefined): FleetNodes | null {
  if (!s) return null;
  if (s.nodes === undefined || s.readyNodes === undefined) {
    if (s.pending && !s.status) return { pending: true };
    return { text: "—", title: s.error || "Node count unavailable" };
  }
  const more = s.nodesTruncated ? "+" : "";
  const down = s.nodes - s.readyNodes;
  const title = [`${s.readyNodes}${more} of ${plural(s.nodes, "node")}${more} ready`, down > 0 && `${plural(down, "node")} not ready`, s.error]
    .filter(Boolean)
    .join(" · ");
  return { text: `${s.readyNodes}${more}/${s.nodes}${more}`, tone: down > 0 ? "warn" : "ok", title };
}

/** One line answering "is anything red" across the summarised clusters. */
export function fleetRollup(sums: FleetSummary[]): string {
  if (sums.length === 0) return "";
  let notReady = 0;
  let redClusters = 0;
  let unreachable = 0;
  let checking = 0;
  for (const s of sums) {
    if (s.status === "unreachable") unreachable++;
    else if (!s.status && s.pending) checking++;
    if (s.nodes !== undefined && s.readyNodes !== undefined && s.readyNodes < s.nodes) {
      notReady += s.nodes - s.readyNodes;
      redClusters++;
    }
  }
  const parts = [
    notReady > 0 ? `${plural(notReady, "node")} not ready in ${plural(redClusters, "cluster")}` : unreachable === 0 && checking === 0 ? "all nodes ready" : "",
    unreachable > 0 && `${unreachable} unreachable`,
    checking > 0 && `${checking} checking…`,
  ].filter(Boolean);
  return ["Summary", ...parts].join(" · ");
}
