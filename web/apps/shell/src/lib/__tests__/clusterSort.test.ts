import { describe, expect, it } from "vitest";
import { sortClusters, filterClusters } from "../clusterSort";
import type { ClusterInfo } from "../api";
import type { ClusterMeta } from "../cluster-meta-store";

const mkCluster = (id: string, status: ClusterInfo["status"] = "reachable"): ClusterInfo => ({
  id,
  context: id,
  server: `https://${id}.example.com`,
  status,
});

// ── sortClusters ─────────────────────────────────────────────────────────────

describe("sortClusters", () => {
  it("returns clusters in alpha order when no meta", () => {
    const list = [mkCluster("z"), mkCluster("a"), mkCluster("m")];
    const result = sortClusters(list, {});
    expect(result.map((c) => c.id)).toEqual(["a", "m", "z"]);
  });

  it("pinned clusters come before unpinned", () => {
    const list = [mkCluster("b"), mkCluster("a")];
    const meta: Record<string, ClusterMeta> = { b: { pinned: true } };
    const result = sortClusters(list, meta);
    expect(result[0]!.id).toBe("b");
    expect(result[1]!.id).toBe("a");
  });

  // Rows must not jump when you open one: order is pinned first, then by
  // name, and never by last use.
  it("ignores lastUsed so the order stays put after opening a cluster", () => {
    const list = [mkCluster("a"), mkCluster("b"), mkCluster("c")];
    const meta: Record<string, ClusterMeta> = { c: { lastUsed: 5000 } };
    expect(sortClusters(list, meta).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("pinned comes before recently-used unpinned", () => {
    const list = [mkCluster("unpinned-recent"), mkCluster("pinned-old")];
    const meta: Record<string, ClusterMeta> = {
      "unpinned-recent": { lastUsed: 9999 },
      "pinned-old": { pinned: true, lastUsed: 1 },
    };
    const result = sortClusters(list, meta);
    expect(result[0]!.id).toBe("pinned-old");
  });
});

// ── filterClusters ────────────────────────────────────────────────────────────

describe("filterClusters", () => {
  it("returns all visible clusters when query is empty", () => {
    const list = [mkCluster("prod"), mkCluster("staging")];
    const meta: Record<string, ClusterMeta> = {};
    expect(filterClusters(list, meta, "")).toHaveLength(2);
  });

  it("excludes hidden clusters", () => {
    const list = [mkCluster("prod"), mkCluster("hidden-one")];
    const meta: Record<string, ClusterMeta> = { "hidden-one": { hidden: true } };
    const result = filterClusters(list, meta, "");
    expect(result.map((c) => c.id)).toEqual(["prod"]);
  });

  it("filters by cluster id substring (case-insensitive)", () => {
    const list = [mkCluster("prod-us-east"), mkCluster("staging-eu"), mkCluster("dev")];
    const meta: Record<string, ClusterMeta> = {};
    expect(filterClusters(list, meta, "prod")).toHaveLength(1);
    expect(filterClusters(list, meta, "STAGING")).toHaveLength(1);
  });

  it("filters by alias", () => {
    const list = [mkCluster("arn:aws:eks:us-east-1:1234:cluster/myapp")];
    const meta: Record<string, ClusterMeta> = {
      "arn:aws:eks:us-east-1:1234:cluster/myapp": { alias: "Production EKS" },
    };
    expect(filterClusters(list, meta, "production")).toHaveLength(1);
    expect(filterClusters(list, meta, "nothing")).toHaveLength(0);
  });

  it("hidden clusters are excluded even if they match query", () => {
    const list = [mkCluster("prod")];
    const meta: Record<string, ClusterMeta> = { prod: { hidden: true } };
    expect(filterClusters(list, meta, "prod")).toHaveLength(0);
  });
});

describe("filterClusters matches what the user sees", () => {
  it("finds a cluster by its context (an EKS ARN with ':' and '/') and by server URL", () => {
    const c = { id: "arn-aws-eks-eu-west-1-123-cluster-prod", context: "arn:aws:eks:eu-west-1:123:cluster/prod", server: "https://ABC.gr7.eu-west-1.eks.amazonaws.com", status: "reachable" as const };
    expect(filterClusters([c], {}, "cluster/prod")).toHaveLength(1);
    expect(filterClusters([c], {}, "eks.amazonaws")).toHaveLength(1);
    expect(filterClusters([c], {}, "staging")).toHaveLength(0);
  });
});

