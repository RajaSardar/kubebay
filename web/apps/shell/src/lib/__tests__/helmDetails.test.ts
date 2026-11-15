import { describe, expect, it } from "vitest";
import { groupResources, resourceHref, stuckFor } from "../helmDetails";
import type { ReleaseResource } from "../api";

// ADR 0004 S8: a release's Overview lists what it created, grouped, each a
// link to its own page, and says when the release is stuck mid-change.

const res = (over: Partial<ReleaseResource>): ReleaseResource => ({
  apiVersion: "v1",
  kind: "ConfigMap",
  resource: "configmaps",
  namespace: "shop",
  name: "web",
  namespaced: true,
  served: true,
  ...over,
});

describe("resourceHref", () => {
  it("links a known kind to its page, a cluster-scoped one without a namespace", () => {
    expect(resourceHref(res({ kind: "Deployment", apiVersion: "apps/v1", resource: "deployments" }))).toBe("/detail/deployments/shop/web");
    expect(resourceHref(res({ kind: "ClusterRole", apiVersion: "rbac.authorization.k8s.io/v1", resource: "clusterroles", namespace: undefined, namespaced: false }))).toBe(
      "/detail/clusterroles/_/web",
    );
  });

  it("links a custom resource by the plural the cluster serves it as", () => {
    expect(resourceHref(res({ kind: "Certificate", apiVersion: "cert-manager.io/v1", resource: "certificates" }))).toBe(
      "/detail/ext--cert-manager.io--v1--certificates/shop/web",
    );
  });

  it("doesn't guess a link for a kind the cluster no longer serves", () => {
    expect(resourceHref(res({ kind: "Widget", apiVersion: "example.com/v1", resource: undefined, served: false }))).toBeUndefined();
  });
});

describe("groupResources", () => {
  it("groups by what the objects are for, workloads first, kinds in order within", () => {
    const groups = groupResources([
      res({ kind: "Secret", name: "db" }),
      res({ kind: "Service", name: "web" }),
      res({ kind: "Deployment", name: "web" }),
      res({ kind: "ClusterRole", name: "reader", namespaced: false }),
      res({ kind: "Widget", name: "gizmo", served: false }),
      res({ kind: "ConfigMap", name: "cfg" }),
    ]);
    expect(groups.map((g) => [g.group, g.rows.map((r) => `${r.kind}/${r.name}`)])).toEqual([
      ["Workloads", ["Deployment/web"]],
      ["Networking", ["Service/web"]],
      ["Config", ["ConfigMap/cfg", "Secret/db"]],
      ["Access", ["ClusterRole/reader"]],
      ["Other", ["Widget/gizmo"]],
    ]);
  });
});

describe("stuckFor", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  it("says how long a pending release has outlasted Helm's 5-minute timeout", () => {
    expect(stuckFor({ status: "pending-upgrade", updated: "2026-10-28T11:51:00Z" }, now)).toBe(9);
  });
  it("is nothing for a settled release or one still within the timeout", () => {
    expect(stuckFor({ status: "deployed", updated: "2026-10-28T11:00:00Z" }, now)).toBeNull();
    expect(stuckFor({ status: "pending-install", updated: "2026-10-28T11:58:00Z" }, now)).toBeNull();
    expect(stuckFor({ status: "pending-rollback" }, now)).toBeNull();
  });
});
