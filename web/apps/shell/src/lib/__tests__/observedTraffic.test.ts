import { describe, expect, it } from "vitest";
import { OBSERVED_PROBES, observedEdges, type ProbeResult } from "../observedTraffic";
import type { MapNode } from "../serviceMap";

const node = (id: string, type: MapNode["type"], name: string, ns = "shop"): MapNode => ({
  id, type, name, detail: "", health: "ok", ref: { slug: "x", ns, name }, position: { x: 0, y: 0 },
});
const nodes = [node("wl:Deployment:web", "workload", "web"), node("wl:Deployment:api", "workload", "api"), node("ing:front", "ingress", "front"), node("svc:shop/api", "service", "api")];
const sample = (metric: Record<string, string>, v: string) => ({ metric, value: [1700000000, v] as [number, string] });

describe("observed probes", () => {
  it("offers only istio_requests_total and the nginx ingress controller counter", () => {
    expect(OBSERVED_PROBES.map((p) => p.metric)).toEqual(["istio_requests_total", "nginx_ingress_controller_requests"]);
  });

  it("builds a presence query and a namespace-scoped rate query", () => {
    const istio = OBSERVED_PROBES[0]!;
    expect(istio.presenceQuery).toBe("count(istio_requests_total)");
    expect(istio.rateQuery("shop")).toContain('destination_workload_namespace="shop"');
    expect(istio.rateQuery("shop")).toContain("source_workload");
  });

  it("refuses a namespace that could break out of the label matcher", () => {
    expect(() => OBSERVED_PROBES[0]!.rateQuery('x"} or vector(1) #')).toThrow();
  });
});

describe("observedEdges", () => {
  it("turns istio workload pairs into observed edges between known workloads", () => {
    const istio = OBSERVED_PROBES[0]!;
    const res: ProbeResult = { probe: istio, query: istio.rateQuery("shop"), at: 1700000000000, samples: [
      sample({ source_workload: "web", source_workload_namespace: "shop", destination_workload: "api", destination_workload_namespace: "shop" }, "2.5"),
      sample({ source_workload: "unknown", source_workload_namespace: "unknown", destination_workload: "api", destination_workload_namespace: "shop" }, "1"),
      sample({ source_workload: "web", source_workload_namespace: "shop", destination_workload: "ghost", destination_workload_namespace: "shop" }, "1"),
      sample({ source_workload: "web", source_workload_namespace: "other", destination_workload: "api", destination_workload_namespace: "shop" }, "1"),
      sample({ source_workload: "api", source_workload_namespace: "shop", destination_workload: "web", destination_workload_namespace: "shop" }, "0"),
    ] };
    const edges = observedEdges(res, "shop", nodes);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "wl:Deployment:web", target: "wl:Deployment:api", basis: "observed", kind: "traffic", rate: 2.5, observedAt: 1700000000000 });
    expect(edges[0]!.evidence).toContain("istio_requests_total");
  });

  it("turns nginx ingress samples into Ingress to Service edges", () => {
    const nginx = OBSERVED_PROBES[1]!;
    const res: ProbeResult = { probe: nginx, query: nginx.rateQuery("shop"), at: 5, samples: [sample({ ingress: "front", namespace: "shop", service: "api" }, "0.4")] };
    const edges = observedEdges(res, "shop", nodes);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "ing:front", target: "svc:shop/api", basis: "observed", rate: 0.4 });
  });

  it("returns nothing for a malformed sample rather than guessing", () => {
    const nginx = OBSERVED_PROBES[1]!;
    const res: ProbeResult = { probe: nginx, query: "q", at: 1, samples: [sample({ service: "api" }, "NaN"), sample({}, "1")] };
    expect(observedEdges(res, "shop", nodes)).toEqual([]);
  });
});
