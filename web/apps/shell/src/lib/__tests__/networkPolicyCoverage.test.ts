import { describe, it, expect } from "vitest";
import { findNetworkPolicyCoverageGaps } from "../networkPolicyCoverage";

function pod(ns: string, name: string, labels: Record<string, string>) {
  return { metadata: { namespace: ns, name, labels } };
}

function netpol(ns: string, name: string, podSelector: Record<string, unknown> = {}) {
  return { metadata: { namespace: ns, name }, spec: { podSelector } };
}

describe("findNetworkPolicyCoverageGaps", () => {
  it("flags every pod group in a namespace with zero NetworkPolicies at all", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }), pod("shop", "checkout-1", { app: "checkout" })];
    const gaps = findNetworkPolicyCoverageGaps(pods, []);
    expect(gaps).toHaveLength(2);
    expect(gaps.map((g) => g.appLabel).sort()).toEqual(["cart", "checkout"]);
    expect(gaps.every((g) => g.reason === "no-policy-in-namespace")).toBe(true);
  });

  it("does not flag a namespace where a policy with an empty podSelector covers everything", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" })];
    const policies = [netpol("shop", "default-deny", {})];
    expect(findNetworkPolicyCoverageGaps(pods, policies)).toHaveLength(0);
  });

  it("flags a specific pod group not selected by any policy, even though the namespace has policies", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }), pod("shop", "checkout-1", { app: "checkout" })];
    const policies = [netpol("shop", "allow-cart", { matchLabels: { app: "cart" } })];
    const gaps = findNetworkPolicyCoverageGaps(pods, policies);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ namespace: "shop", appLabel: "checkout", reason: "not-selected-by-any-policy" });
  });

  it("does not flag a pod group selected by at least one of several policies", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" })];
    const policies = [netpol("shop", "allow-checkout", { matchLabels: { app: "checkout" } }), netpol("shop", "allow-cart", { matchLabels: { app: "cart" } })];
    expect(findNetworkPolicyCoverageGaps(pods, policies)).toHaveLength(0);
  });

  it("groups pods by namespace+app label rather than flagging one finding per pod", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }), pod("shop", "cart-2", { app: "cart" }), pod("shop", "cart-3", { app: "cart" })];
    const gaps = findNetworkPolicyCoverageGaps(pods, []);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ namespace: "shop", appLabel: "cart", podCount: 3 });
  });

  it("respects matchExpressions, not just matchLabels", () => {
    const pods = [pod("shop", "cart-1", { app: "cart", tier: "frontend" })];
    const policies = [netpol("shop", "tier-policy", { matchExpressions: [{ key: "tier", operator: "In", values: ["frontend"] }] })];
    expect(findNetworkPolicyCoverageGaps(pods, policies)).toHaveLength(0);
  });

  it("returns an empty list when there are no pods", () => {
    expect(findNetworkPolicyCoverageGaps([], [])).toEqual([]);
  });

  it("treats a pod with no labels as (unlabelled), same convention as the connectivity matrix page", () => {
    const pods = [pod("shop", "mystery-1", {})];
    const gaps = findNetworkPolicyCoverageGaps(pods, []);
    expect(gaps[0]?.appLabel).toBe("(unlabelled)");
  });
});
