import { describe, it, expect } from "vitest";
import { findServiceSelectorMismatches } from "../serviceSelectorMismatch";

function svc(ns: string, name: string, selector: Record<string, string> | undefined, type = "ClusterIP") {
  return { metadata: { namespace: ns, name }, spec: { selector, type } };
}
function pod(ns: string, name: string, labels: Record<string, string>) {
  return { metadata: { namespace: ns, name, labels } };
}
function slice(ns: string, serviceName: string, readyFlags: boolean[]) {
  return {
    metadata: { namespace: ns, labels: { "kubernetes.io/service-name": serviceName } },
    endpoints: readyFlags.map((ready) => ({ addresses: ["10.0.0.1"], conditions: { ready } })),
  };
}

describe("findServiceSelectorMismatches", () => {
  it("flags a Service whose selector matches zero pods in its namespace", () => {
    const services = [svc("shop", "cart", { app: "cart" })];
    const pods = [pod("shop", "checkout-1", { app: "checkout" })];
    const findings = findServiceSelectorMismatches(services, pods, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ namespace: "shop", serviceName: "cart", reason: "no-matching-pods" });
  });

  it("does not flag a Service whose selector matches at least one pod and has ready endpoints", () => {
    const services = [svc("shop", "cart", { app: "cart" })];
    const pods = [pod("shop", "cart-1", { app: "cart" })];
    const slices = [slice("shop", "cart", [true])];
    expect(findServiceSelectorMismatches(services, pods, slices)).toHaveLength(0);
  });

  it("flags a Service whose selector matches pods but every endpoint is not-ready", () => {
    const services = [svc("shop", "cart", { app: "cart" })];
    const pods = [pod("shop", "cart-1", { app: "cart" })];
    const slices = [slice("shop", "cart", [false, false])];
    const findings = findServiceSelectorMismatches(services, pods, slices);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ reason: "zero-ready-endpoints" });
  });

  it("does not flag a Service with no selector -- headless/manually-managed Endpoints are legitimate", () => {
    const services = [svc("shop", "external-db", undefined)];
    expect(findServiceSelectorMismatches(services, [], [])).toHaveLength(0);
  });

  it("does not flag an ExternalName Service, which has no selector concept", () => {
    const services = [svc("shop", "external-api", { app: "ignored" }, "ExternalName")];
    expect(findServiceSelectorMismatches(services, [], [])).toHaveLength(0);
  });

  it("only considers pods in the same namespace as the Service", () => {
    const services = [svc("shop", "cart", { app: "cart" })];
    const pods = [pod("other-ns", "cart-1", { app: "cart" })];
    const findings = findServiceSelectorMismatches(services, pods, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toBe("no-matching-pods");
  });

  it("respects multi-key selectors -- a pod must match every key, not just one", () => {
    const services = [svc("shop", "cart", { app: "cart", tier: "backend" })];
    const pods = [pod("shop", "cart-1", { app: "cart", tier: "frontend" })];
    expect(findServiceSelectorMismatches(services, pods, [])[0]?.reason).toBe("no-matching-pods");
  });

  it("returns an empty list for no services", () => {
    expect(findServiceSelectorMismatches([], [], [])).toEqual([]);
  });
});
