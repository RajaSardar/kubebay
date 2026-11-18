import { describe, expect, it } from "vitest";
import { buildServiceMap, filterEdges, type ServiceMapInput } from "../serviceMap";

const owner = (kind: string, name: string) => ({ ownerReferences: [{ kind, name }] });

function fixture(): ServiceMapInput {
  return {
    namespace: "shop",
    ingresses: [
      {
        metadata: { name: "web", namespace: "shop" },
        spec: { rules: [{ host: "shop.example.com", http: { paths: [{ path: "/", backend: { service: { name: "frontend", port: { number: 80 } } } }] } }] },
      },
    ],
    services: [
      { metadata: { name: "frontend", namespace: "shop" }, spec: { selector: { app: "frontend" }, ports: [{ port: 80 }] } },
      { metadata: { name: "api", namespace: "shop" }, spec: { selector: { app: "api" }, ports: [{ port: 8080 }] } },
    ],
    slices: [
      {
        metadata: { name: "frontend-abc", namespace: "shop", labels: { "kubernetes.io/service-name": "frontend" } },
        endpoints: [
          { conditions: { ready: true }, targetRef: { kind: "Pod", name: "frontend-1" } },
          { conditions: { ready: false }, targetRef: { kind: "Pod", name: "frontend-2" } },
        ],
      },
    ],
    pods: [
      { metadata: { name: "frontend-1", labels: { app: "frontend" }, ...owner("ReplicaSet", "frontend-rs") } },
      { metadata: { name: "frontend-2", labels: { app: "frontend" }, ...owner("ReplicaSet", "frontend-rs") } },
      { metadata: { name: "api-1", labels: { app: "api" }, ...owner("ReplicaSet", "api-rs") } },
    ],
    replicaSets: [
      { metadata: { name: "frontend-rs", ...owner("Deployment", "frontend") } },
      { metadata: { name: "api-rs", ...owner("Deployment", "api") } },
    ],
    deployments: [
      {
        metadata: { name: "frontend" },
        spec: { replicas: 2, template: { spec: { containers: [{ env: [{ name: "API_URL", value: "http://api:8080/v1" }] }] } } },
        status: { readyReplicas: 1 },
      },
      {
        metadata: { name: "api" },
        spec: { replicas: 1, template: { spec: { containers: [{ env: [{ name: "DB_HOST", value: "postgres.data.svc" }, { name: "MODE", value: "true" }] }] } } },
        status: { readyReplicas: 1 },
      },
    ],
    statefulSets: [],
    daemonSets: [],
    networkPolicies: [
      {
        metadata: { name: "api-from-frontend" },
        spec: { podSelector: { matchLabels: { app: "api" } }, policyTypes: ["Ingress"], ingress: [{ from: [{ podSelector: { matchLabels: { app: "frontend" } } }] }] },
      },
    ],
  };
}

const find = (g: ReturnType<typeof buildServiceMap>, source: string, target: string, kind?: string) =>
  g.edges.find((e) => e.source === source && e.target === target && (!kind || e.kind === kind));

describe("buildServiceMap", () => {
  it("draws Ingress to Service as a declared route with host and path evidence", () => {
    const e = find(buildServiceMap(fixture()), "ing:web", "svc:shop/frontend");
    expect(e).toMatchObject({ kind: "routes-to", basis: "declared" });
    expect(e?.evidence).toContain("shop.example.com/");
  });

  it("draws Service to its workload from EndpointSlices and counts ready endpoints", () => {
    const g = buildServiceMap(fixture());
    expect(find(g, "svc:shop/frontend", "wl:Deployment:frontend")).toMatchObject({ kind: "serves", basis: "declared" });
    expect(g.nodes.find((n) => n.id === "svc:shop/frontend")?.detail).toContain("1/2 ready");
  });

  it("falls back to the selector, labelled inferred, when a Service has no EndpointSlices", () => {
    const g = buildServiceMap(fixture());
    expect(find(g, "svc:shop/api", "wl:Deployment:api")).toMatchObject({ kind: "serves", basis: "inferred" });
  });

  it("draws NetworkPolicy allow edges between workloads as declared allowed paths", () => {
    const e = find(buildServiceMap(fixture()), "wl:Deployment:frontend", "wl:Deployment:api");
    expect(e).toMatchObject({ kind: "allowed", basis: "declared", evidence: "NetworkPolicy api-from-frontend" });
  });

  it("infers env references to Services and always carries the evidence", () => {
    const g = buildServiceMap(fixture());
    expect(find(g, "wl:Deployment:frontend", "svc:shop/api")).toMatchObject({ kind: "references", basis: "inferred", evidence: "env API_URL=http://api:8080/v1" });
    const ext = find(g, "wl:Deployment:api", "svc:data/postgres");
    expect(ext).toMatchObject({ kind: "references", basis: "inferred", evidence: "env DB_HOST=postgres.data.svc" });
    expect(g.nodes.find((n) => n.id === "svc:data/postgres")).toMatchObject({ external: true });
    expect(g.edges.filter((e) => e.evidence?.includes("MODE"))).toEqual([]);
  });

  it("every edge is labelled and inferred edges have evidence; none is observed", () => {
    for (const e of buildServiceMap(fixture()).edges) {
      expect(["declared", "inferred"]).toContain(e.basis);
      if (e.basis === "inferred") expect(e.evidence).toBeTruthy();
    }
  });

  it("shows a route to a missing Service as a missing node, not silently", () => {
    const f = fixture();
    f.ingresses = [{ metadata: { name: "web" }, spec: { defaultBackend: { service: { name: "ghost" } } } }];
    const n = buildServiceMap(f).nodes.find((x) => x.id === "svc:shop/ghost");
    expect(n).toMatchObject({ health: "err" });
    expect(n?.detail).toContain("not found");
  });

  it("gives every node a drawer reference", () => {
    const g = buildServiceMap(fixture());
    expect(g.nodes.find((n) => n.id === "ing:web")?.ref).toEqual({ slug: "ingresses", ns: "shop", name: "web" });
    expect(g.nodes.find((n) => n.id === "wl:Deployment:api")?.ref).toEqual({ slug: "deployments", ns: "shop", name: "api" });
    expect(g.nodes.find((n) => n.id === "svc:data/postgres")?.ref).toEqual({ slug: "services", ns: "data", name: "postgres" });
  });

  it("is empty for an empty namespace", () => {
    const f = fixture();
    for (const k of ["ingresses", "services", "slices", "pods", "replicaSets", "deployments", "networkPolicies"] as const) f[k] = [];
    expect(buildServiceMap(f)).toEqual({ nodes: [], edges: [] });
  });
});

describe("filterEdges", () => {
  it("hides inferred or allowed edges on request", () => {
    const g = buildServiceMap(fixture());
    expect(filterEdges(g.edges, { inferred: false, allowed: true }).some((e) => e.basis === "inferred")).toBe(false);
    expect(filterEdges(g.edges, { inferred: true, allowed: false }).some((e) => e.kind === "allowed")).toBe(false);
    expect(filterEdges(g.edges, { inferred: true, allowed: true })).toHaveLength(g.edges.length);
  });
});
