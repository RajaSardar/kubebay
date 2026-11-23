import { describe, expect, it } from "vitest";
import { fleetNodes, fleetRollup, summaryTargets, MAX_SUMMARY_IDS } from "../fleetSummary";
import type { ClusterInfo, FleetSummary } from "../api";

const c = (id: string, status: ClusterInfo["status"] = "reachable", connected = false): ClusterInfo => ({ id, context: id, server: "https://x", status, connected });

describe("summaryTargets", () => {
  it("asks only for shown clusters that are not connected and can build a client", () => {
    const shown = [c("a"), c("live", "reachable", true), c("broken", "misconfigured"), c("down", "unreachable"), c("b")];
    expect(summaryTargets(shown, (x) => !!x.connected)).toEqual(["a", "down", "b"]);
  });

  it("caps one request", () => {
    const shown = Array.from({ length: MAX_SUMMARY_IDS + 30 }, (_, i) => c(`c${i}`));
    expect(summaryTargets(shown, () => false)).toHaveLength(MAX_SUMMARY_IDS);
  });
});

describe("fleetNodes", () => {
  it("shows ready over total, ok when all are ready", () => {
    expect(fleetNodes({ id: "a", status: "reachable", nodes: 3, readyNodes: 3 })).toMatchObject({ text: "3/3", tone: "ok" });
  });

  it("warns when a node is not ready", () => {
    const n = fleetNodes({ id: "a", status: "reachable", nodes: 3, readyNodes: 2 });
    expect(n).toMatchObject({ text: "2/3", tone: "warn" });
    expect(n && "title" in n ? n.title : "").toContain("1 node not ready");
  });

  it("marks a truncated count", () => {
    expect(fleetNodes({ id: "a", status: "reachable", nodes: 5000, readyNodes: 5000, nodesTruncated: true })).toMatchObject({ text: "5000+/5000+" });
  });

  it("is pending with no previous result, and explains a missing node count", () => {
    expect(fleetNodes({ id: "a", pending: true })).toEqual({ pending: true });
    expect(fleetNodes({ id: "a", status: "reachable", error: "nodes: forbidden" })).toMatchObject({ text: "—", title: "nodes: forbidden" });
    expect(fleetNodes(undefined)).toBeNull();
  });
});

describe("fleetRollup", () => {
  it("counts not-ready nodes and unreachable clusters across the summaries", () => {
    const sums: FleetSummary[] = [
      { id: "a", status: "reachable", nodes: 3, readyNodes: 1 },
      { id: "b", status: "reachable", nodes: 2, readyNodes: 1 },
      { id: "c", status: "unreachable", error: "dial tcp" },
      { id: "d", pending: true },
      { id: "e", status: "reachable", nodes: 4, readyNodes: 4 },
    ];
    expect(fleetRollup(sums)).toBe("Summary · 3 nodes not ready in 2 clusters · 1 unreachable · 1 checking…");
  });

  it("says all is well when nothing is red", () => {
    expect(fleetRollup([{ id: "a", status: "reachable", nodes: 1, readyNodes: 1 }])).toBe("Summary · all nodes ready");
    expect(fleetRollup([])).toBe("");
  });
});
