import { describe, expect, it } from "vitest";
import { OBSERVED_PROBES, capSeries, observedEdges, observedEdgesAllNamespaces, type ProbeResult } from "../observedTraffic";
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

describe("observed traffic on All namespaces", () => {
  // Nodes as buildAllNamespacesMap names them: workloads and ingresses qualified by namespace, each in its group.
  const all: MapNode[] = [
    { ...node("wl:a/Deployment:web", "workload", "web", "a"), group: "a" },
    { ...node("wl:b/Deployment:api", "workload", "api", "b"), group: "b" },
    { ...node("wl:b/Deployment:web", "workload", "web", "b"), group: "b" },
    { ...node("ing:a/front", "ingress", "front", "a"), group: "a" },
    { ...node("svc:a/web", "service", "web", "a"), group: "a" },
    { ...node("svc:c/pg", "workload", "pg", "c"), group: "c", external: true },
  ];
  const istio = OBSERVED_PROBES[0]!;
  const nginx = OBSERVED_PROBES[1]!;

  it("builds one cluster-wide query per metric, grouped by source and destination namespace and workload, capped with topk", () => {
    const q = istio.clusterRateQuery(500);
    expect(q).toMatch(/^topk\(501, sum by \(source_workload, source_workload_namespace, destination_workload, destination_workload_namespace\)/);
    expect(q).not.toContain("destination_workload_namespace=");
    expect(q).toContain('reporter="destination"');
    const n = nginx.clusterRateQuery(500);
    expect(n).toMatch(/^topk\(501, sum by \(ingress, namespace, service\)/);
    expect(n).toContain("nginx_ingress_controller_requests[5m]");
  });

  it("refuses a series cap that is not a positive integer", () => {
    expect(() => istio.clusterRateQuery(0)).toThrow();
    expect(() => istio.clusterRateQuery(1.5)).toThrow();
  });

  it("draws cross-namespace observed edges between workloads of different groups, marked cross-namespace", () => {
    const res: ProbeResult = { probe: istio, query: istio.clusterRateQuery(500), at: 9, samples: [
      sample({ source_workload: "web", source_workload_namespace: "a", destination_workload: "api", destination_workload_namespace: "b" }, "1.5"),
      sample({ source_workload: "web", source_workload_namespace: "b", destination_workload: "api", destination_workload_namespace: "b" }, "0.5"),
      sample({ source_workload: "web", source_workload_namespace: "zz", destination_workload: "api", destination_workload_namespace: "b" }, "1"),
    ] };
    const edges = observedEdgesAllNamespaces(res, all);
    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual(expect.objectContaining({ source: "wl:a/Deployment:web", target: "wl:b/Deployment:api", basis: "observed", kind: "traffic", rate: 1.5, crossNamespace: true, observedAt: 9 }));
    const same = edges.find((e) => e.source === "wl:b/Deployment:web")!;
    expect(same.crossNamespace).toBeFalsy();
    expect(same.evidence).toContain("istio_requests_total");
  });

  it("matches nginx samples to the Ingress and Service of the sample's namespace, never an external stand-in", () => {
    const res: ProbeResult = { probe: nginx, query: "q", at: 1, samples: [
      sample({ ingress: "front", namespace: "a", service: "web" }, "0.2"),
      sample({ ingress: "front", namespace: "b", service: "web" }, "0.2"),
    ] };
    expect(observedEdgesAllNamespaces(res, all)).toEqual([expect.objectContaining({ source: "ing:a/front", target: "svc:a/web", rate: 0.2 })]);
    const ext = { ...res, probe: istio, samples: [sample({ source_workload: "web", source_workload_namespace: "a", destination_workload: "pg", destination_workload_namespace: "c" }, "1")] };
    expect(observedEdgesAllNamespaces(ext, all)).toEqual([]);
  });

  it("draws nothing for a series whose node the 400-node budget dropped", () => {
    const res: ProbeResult = { probe: istio, query: "q", at: 1, samples: [
      sample({ source_workload: "web", source_workload_namespace: "a", destination_workload: "cut", destination_workload_namespace: "b" }, "3"),
    ] };
    expect(observedEdgesAllNamespaces(res, all)).toEqual([]);
  });
});

describe("capSeries", () => {
  it("keeps the highest-rate series up to the cap and says when it cut some", () => {
    const s = [sample({ a: "1" }, "1"), sample({ a: "2" }, "5"), sample({ a: "3" }, "3")];
    const r = capSeries(s, 2);
    expect(r.truncated).toBe(true);
    expect(r.samples.map((x) => x.metric.a)).toEqual(["2", "3"]);
    expect(capSeries(s, 3)).toEqual({ samples: s, truncated: false });
  });
});
