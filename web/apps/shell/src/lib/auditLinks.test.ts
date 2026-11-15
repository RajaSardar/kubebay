import { describe, it, expect } from "vitest";
import { auditObjectHref } from "./auditLinks";

describe("auditObjectHref", () => {
  it("links a pod, whatever the subresource, to its drawer on the Pods page", () => {
    expect(auditObjectHref({ resource: "pods", namespace: "shop", name: "api-1" })).toBe("/workloads?pod=shop%2Fapi-1");
  });

  it("links kinds with a detail page, namespaced or cluster-scoped", () => {
    expect(auditObjectHref({ resource: "deployments", namespace: "shop", name: "api" })).toBe("/detail/deployments/shop/api");
    expect(auditObjectHref({ resource: "nodes", name: "worker-1" })).toBe("/detail/nodes/_/worker-1");
  });

  it("has no link without a name or a page for the kind", () => {
    expect(auditObjectHref({ resource: "secrets", namespace: "shop" })).toBeNull();
    expect(auditObjectHref({ resource: "tokenreviews", name: "x" })).toBeNull();
    expect(auditObjectHref({ resource: "clusterrolebindings", name: "oops" })).toBe("/detail/clusterrolebindings/_/oops");
    expect(auditObjectHref(undefined)).toBeNull();
  });
});
