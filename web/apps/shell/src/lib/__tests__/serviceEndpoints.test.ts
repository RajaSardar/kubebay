import { describe, expect, it } from "vitest";
import { endpointCountsByService, summarizeEndpoints } from "../serviceEndpoints";

// Backlog 64: a Service's endpoints, from its EndpointSlices.
const slice = (svc: string, endpoints: unknown[], ports: unknown[] = [{ name: "http", port: 8080, protocol: "TCP" }], ns = "shop") => ({
  metadata: { name: `${svc}-x`, namespace: ns, labels: { "kubernetes.io/service-name": svc } },
  addressType: "IPv4",
  endpoints,
  ports,
});
const ep = (ip: string, ready: boolean | undefined, pod?: string, extra: Record<string, unknown> = {}) => ({
  addresses: [ip],
  conditions: ready === undefined ? {} : { ready },
  nodeName: "node-1",
  targetRef: pod ? { kind: "Pod", name: pod, namespace: "shop" } : undefined,
  ...extra,
});

describe("summarizeEndpoints", () => {
  it("lists addresses with readiness, target pod and node, and the ports", () => {
    const s = summarizeEndpoints([slice("web", [ep("10.0.0.1", true, "web-1"), ep("10.0.0.2", false, "web-2")])]);
    expect(s.ready).toBe(1);
    expect(s.notReady).toBe(1);
    expect(s.endpoints).toEqual([
      { address: "10.0.0.1", ready: true, node: "node-1", target: { kind: "Pod", name: "web-1", ns: "shop" } },
      { address: "10.0.0.2", ready: false, node: "node-1", target: { kind: "Pod", name: "web-2", ns: "shop" } },
    ]);
    expect(s.ports).toEqual([{ name: "http", port: 8080, protocol: "TCP" }]);
  });

  it("treats an unset ready condition as ready (the API's meaning of nil) and merges ports across slices", () => {
    const s = summarizeEndpoints([
      slice("web", [ep("10.0.0.1", undefined)], [{ port: 80 }]),
      slice("web", [ep("10.0.0.3", true)], [{ port: 80 }, { name: "m", port: 9090, protocol: "UDP" }]),
    ]);
    expect(s.ready).toBe(2);
    expect(s.ports).toEqual([
      { name: "", port: 80, protocol: "TCP" },
      { name: "m", port: 9090, protocol: "UDP" },
    ]);
  });

  it("is empty for no slices, and has no target for an address without a targetRef", () => {
    expect(summarizeEndpoints([])).toEqual({ endpoints: [], ports: [], ready: 0, notReady: 0 });
    expect(summarizeEndpoints([slice("x", [ep("1.1.1.1", true)])]).endpoints[0]?.target).toBeUndefined();
  });
});

describe("endpointCountsByService", () => {
  it("counts ready and total per namespace/service", () => {
    const m = endpointCountsByService([
      slice("web", [ep("10.0.0.1", true), ep("10.0.0.2", false)]),
      slice("web", [ep("10.0.0.3", true)]),
      slice("db", [], [], "data"),
    ]);
    expect(m.get("shop/web")).toEqual({ ready: 2, total: 3 });
    expect(m.get("data/db")).toEqual({ ready: 0, total: 0 });
    expect(m.get("shop/none")).toBeUndefined();
  });
});
