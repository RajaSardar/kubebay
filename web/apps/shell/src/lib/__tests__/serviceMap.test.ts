import { describe, expect, it } from "vitest";
import { buildServiceMap, detectMapCrds, filterEdges, visibleNodes, type ServiceMapInput } from "../serviceMap";

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
    expect(buildServiceMap(f)).toEqual({ nodes: [], edges: [], findings: [] });
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

const gw = (extra: Partial<ServiceMapInput> = {}): ServiceMapInput => ({
  ...fixture(),
  ingresses: [],
  gvrs: { gateways: "gateway.networking.k8s.io/v1/gateways", httpRoutes: "gateway.networking.k8s.io/v1/httproutes" },
  gateways: [{ metadata: { name: "edge", namespace: "shop" }, spec: { gatewayClassName: "x" } }],
  httpRoutes: [
    {
      metadata: { name: "web-route", namespace: "shop" },
      spec: {
        parentRefs: [{ name: "edge" }],
        hostnames: ["shop.example.com"],
        rules: [{ backendRefs: [{ name: "frontend", port: 80, weight: 90 }, { name: "api", port: 8080, namespace: "other" }, { name: "x", kind: "Other" }] }],
      },
    },
  ],
  ...extra,
});

describe("Gateway API", () => {
  it("draws HTTPRoute backendRefs from the Gateway to Services, declared, with route evidence", () => {
    const g = buildServiceMap(gw());
    expect(g.nodes.find((n) => n.id === "gw:shop/edge")).toMatchObject({ type: "ingress", detail: "Gateway", ref: { slug: "ext--gateway.networking.k8s.io--v1--gateways", ns: "shop", name: "edge" } });
    const e = find(g, "gw:shop/edge", "svc:shop/frontend");
    expect(e).toMatchObject({ kind: "routes-to", basis: "declared" });
    expect(e?.evidence).toContain("HTTPRoute web-route");
    expect(e?.evidence).toContain("shop.example.com");
  });

  it("marks a backend in another namespace as cross-namespace and ignores non-Service backends", () => {
    const g = buildServiceMap(gw());
    expect(find(g, "gw:shop/edge", "svc:other/api")).toMatchObject({ crossNamespace: true });
    expect(g.nodes.find((n) => n.id === "svc:other/api")).toMatchObject({ external: true });
    expect(g.edges.some((e) => e.target.endsWith("/x"))).toBe(false);
  });

  it("draws GRPCRoute the same way, and uses the route itself when it has no parent Gateway", () => {
    const g = buildServiceMap(
      gw({
        httpRoutes: [],
        grpcRoutes: [{ metadata: { name: "rpc", namespace: "shop" }, spec: { rules: [{ backendRefs: [{ name: "api", port: 8080 }] }] } }],
      }),
    );
    const e = find(g, "route:GRPCRoute/shop/rpc", "svc:shop/api");
    expect(e).toMatchObject({ kind: "routes-to", basis: "declared" });
    expect(e?.evidence).toContain("GRPCRoute rpc");
  });

  it("reports a route to a missing Service as a finding", () => {
    const g = buildServiceMap(gw({ httpRoutes: [{ metadata: { name: "r", namespace: "shop" }, spec: { parentRefs: [{ name: "edge" }], rules: [{ backendRefs: [{ name: "ghost" }] }] } }] }));
    expect(g.findings).toContainEqual(expect.objectContaining({ kind: "missing-service", nodeId: "svc:shop/ghost" }));
  });
});

describe("ReferenceGrant", () => {
  const grant = (ns: string, from: Record<string, string>[], to: Record<string, string>[]) => ({ metadata: { name: `g-${ns}`, namespace: ns }, spec: { from, to } });
  const fromShop = { group: "gateway.networking.k8s.io", kind: "HTTPRoute", namespace: "shop" };

  it("checks nothing when ReferenceGrants were not read", () => {
    const g = buildServiceMap(gw());
    expect(g.findings.some((f) => f.kind === "ungranted-reference")).toBe(false);
  });

  it("marks a cross-namespace backendRef no ReferenceGrant in the target namespace permits as a finding", () => {
    const g = buildServiceMap(gw({ referenceGrants: [] }));
    expect(g.findings).toContainEqual(
      expect.objectContaining({ kind: "ungranted-reference", nodeId: "svc:other/api", text: expect.stringMatching(/HTTPRoute web-route.*Service api in other.*ReferenceGrant/) }),
    );
    expect(find(g, "gw:shop/edge", "svc:other/api")?.evidence).toMatch(/no ReferenceGrant/);
    // Same-namespace backends need no grant.
    expect(g.findings.some((f) => f.kind === "ungranted-reference" && f.nodeId === "svc:shop/frontend")).toBe(false);
  });

  it("accepts a grant in the target namespace from the route's kind and namespace to Services (any name, or that name)", () => {
    for (const to of [{ group: "", kind: "Service" }, { group: "", kind: "Service", name: "api" }] as Record<string, string>[]) {
      const g = buildServiceMap(gw({ referenceGrants: [grant("other", [fromShop], [to])] }));
      expect(g.findings.some((f) => f.kind === "ungranted-reference")).toBe(false);
      expect(find(g, "gw:shop/edge", "svc:other/api")?.evidence).not.toMatch(/no ReferenceGrant/);
    }
  });

  it("rejects a grant in the wrong namespace, from another kind or namespace, or to another name", () => {
    const bad = [
      grant("shop", [fromShop], [{ group: "", kind: "Service" }]),
      grant("other", [{ ...fromShop, kind: "GRPCRoute" }], [{ group: "", kind: "Service" }]),
      grant("other", [{ ...fromShop, namespace: "elsewhere" }], [{ group: "", kind: "Service" }]),
      grant("other", [fromShop], [{ group: "", kind: "Service", name: "db" }]),
    ];
    for (const b of bad) {
      const g = buildServiceMap(gw({ referenceGrants: [b] }));
      expect(g.findings.some((f) => f.kind === "ungranted-reference")).toBe(true);
    }
  });
});

describe("Istio", () => {
  const istio = (): ServiceMapInput => ({
    ...fixture(),
    ingresses: [],
    gvrs: { virtualServices: "networking.istio.io/v1/virtualservices" },
    virtualServices: [
      {
        metadata: { name: "api-vs", namespace: "shop" },
        spec: { hosts: ["api"], http: [{ route: [{ destination: { host: "api", subset: "v1" }, weight: 80 }, { destination: { host: "postgres.data.svc.cluster.local" } }] }] },
      },
    ],
    destinationRules: [
      { metadata: { name: "api-dr", namespace: "shop" }, spec: { host: "api", subsets: [{ name: "v1", labels: { app: "api" } }, { name: "v2", labels: { app: "nothing" } }] } },
    ],
  });

  it("draws VirtualService destination hosts as declared routes to Services", () => {
    const g = buildServiceMap(istio());
    expect(g.nodes.find((n) => n.id === "vs:shop/api-vs")).toMatchObject({ type: "ingress", detail: "VirtualService" });
    const e = find(g, "vs:shop/api-vs", "svc:shop/api");
    expect(e).toMatchObject({ kind: "routes-to", basis: "declared" });
    expect(e?.evidence).toContain("subset v1");
    expect(find(g, "vs:shop/api-vs", "svc:data/postgres")).toMatchObject({ crossNamespace: true });
  });

  it("draws DestinationRule subsets as declared edges from the Service to the workloads their labels select", () => {
    const g = buildServiceMap(istio());
    const e = find(g, "svc:shop/api", "wl:Deployment:api", "subset");
    expect(e).toMatchObject({ basis: "declared" });
    expect(e?.evidence).toContain("DestinationRule api-dr subset v1");
    expect(g.edges.filter((x) => x.kind === "subset")).toHaveLength(1);
  });
});

describe("findings", () => {
  it("flags a Service with a selector and no ready endpoints", () => {
    const g = buildServiceMap(fixture());
    expect(g.findings.filter((f) => f.kind === "no-ready-endpoints")).toEqual([]);
    const f = fixture();
    f.slices = [{ metadata: { name: "x", labels: { "kubernetes.io/service-name": "frontend" } }, endpoints: [{ conditions: { ready: false } }] }];
    expect(buildServiceMap(f).findings).toContainEqual(expect.objectContaining({ kind: "no-ready-endpoints", nodeId: "svc:shop/frontend" }));
  });

  it("flags a selector Service that matches no pods, but not ExternalName or selector-less ones", () => {
    const f = fixture();
    f.services = [
      { metadata: { name: "lonely" }, spec: { selector: { app: "none" } } },
      { metadata: { name: "ext" }, spec: { type: "ExternalName", externalName: "x.example.com" } },
      { metadata: { name: "manual" }, spec: {} },
    ];
    const ids = buildServiceMap(f).findings.filter((x) => x.kind === "no-ready-endpoints").map((x) => x.nodeId);
    expect(ids).toEqual(["svc:shop/lonely"]);
  });

  it("flags an Ingress route to a missing Service once", () => {
    const f = fixture();
    f.ingresses = [{ metadata: { name: "web" }, spec: { rules: [{ http: { paths: [{ backend: { service: { name: "ghost" } } }, { path: "/b", backend: { service: { name: "ghost" } } }] } }] } }];
    const m = buildServiceMap(f).findings.filter((x) => x.kind === "missing-service");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ nodeId: "svc:shop/ghost" });
    expect(m[0]!.text).toContain("ghost");
  });
});

describe("cross-namespace toggle and detection", () => {
  it("hides cross-namespace edges and the nodes only they reach", () => {
    const g = buildServiceMap(fixture());
    const edges = filterEdges(g.edges, { inferred: true, allowed: true, crossNamespace: false });
    expect(edges.some((e) => e.crossNamespace)).toBe(false);
    expect(visibleNodes(g.nodes, edges).some((n) => n.id === "svc:data/postgres")).toBe(false);
    expect(visibleNodes(g.nodes, edges).some((n) => n.id === "svc:shop/api")).toBe(true);
    expect(filterEdges(g.edges, { inferred: true, allowed: true, crossNamespace: true })).toHaveLength(g.edges.length);
  });

  it("finds Gateway API and Istio CRDs by group and resource, and reports nothing when absent", () => {
    const c = (group: string, resource: string) => ({ group, resource, gvr: `${group}/v1/${resource}` }) as never;
    const d = detectMapCrds([c("gateway.networking.k8s.io", "httproutes"), c("gateway.networking.k8s.io", "gateways"), c("networking.istio.io", "virtualservices"), c("networking.istio.io", "gateways")]);
    expect(d.gvrs).toMatchObject({ httpRoutes: "gateway.networking.k8s.io/v1/httproutes", gateways: "gateway.networking.k8s.io/v1/gateways", virtualServices: "networking.istio.io/v1/virtualservices" });
    expect(d.gvrs.grpcRoutes).toBeUndefined();
    expect(detectMapCrds([c("gateway.networking.k8s.io", "referencegrants")]).gvrs.referenceGrants).toBe("gateway.networking.k8s.io/v1/referencegrants");
    expect(detectMapCrds([]).gvrs).toEqual({});
  });
});
