import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const forbidden = new Map<string, string>();
const rows = new Map<string, unknown[]>();
const navigate = vi.fn();
let crds: unknown[] = [];
let promSource: "manual" | "auto" | "none" = "none";
let promSamples: Record<string, unknown[]> = {};
const promQueries: string[] = [];
const streamNs: (string[] | undefined)[] = [];
const streamCalls: { gvr: string; enabled?: boolean }[] = [];

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), crdApi: { list: vi.fn(async () => crds) },
  promApi: {
    status: vi.fn(async () => ({ source: promSource, target: "", chosen: false, candidates: [] })),
    query: vi.fn(async ({ query }: { query: string }) => {
      promQueries.push(query);
      return (promSamples[query] ?? []) as never;
    }),
  },
}));

vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string, gvr: string, o?: { enabled?: boolean; ns?: string[] }) => {
    streamCalls.push({ gvr, enabled: o?.enabled });
    if (gvr === "v1/services") streamNs.push(o?.ns);
    return { rows: rows.get(gvr) ?? [], synced: !forbidden.has(gvr), connected: true, forbidden: forbidden.get(gvr) };
  }),
}));
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, edges, onNodeClick }: { nodes: { id: string; data: { kb: { name: string } } }[]; edges: unknown[]; onNodeClick: (e: unknown, n: { id: string }) => void }) => (
    <div>
      <span data-testid="edge-count">{edges.length}</span>
      {nodes.map((n) => (
        <button key={n.id} onClick={(e) => onNodeClick(e, n)}>
          {n.data.kb.name}
        </button>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  BackgroundVariant: {},
  Position: {},
}));

const { default: ServiceMapView } = await import("../ServiceMapView");
const { ALL_NAMESPACES } = await import("../../lib/serviceMapAll");
const { OBSERVED_PROBES, OBSERVED_SERIES_CAP } = await import("../../lib/observedTraffic");

const render1 = (namespace = "shop") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ServiceMapView cluster="c1" namespace={namespace} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("ServiceMapView", () => {
  beforeEach(() => {
    forbidden.clear();
    rows.clear();
    crds = [];
    streamCalls.length = 0;
    streamNs.length = 0;
    promSource = "none";
    promSamples = {};
    promQueries.length = 0;
    navigate.mockClear();
  });

  it("says what it can't list when a stream is forbidden", () => {
    forbidden.set("networking.k8s.io/v1/ingresses", 'ingresses is forbidden: User "dev" cannot list resource "ingresses"');
    render1();
    expect(screen.getByText(/can't list ingresses/i)).toBeTruthy();
  });

  it("says the namespace has nothing to map when it is empty", () => {
    render1();
    expect(screen.getByText(/Nothing to map in "shop"/)).toBeTruthy();
  });

  it("explains that edges are declared or inferred, never observed traffic", () => {
    rows.set("v1/services", [{ metadata: { name: "api" }, spec: { selector: { app: "api" } } }]);
    render1();
    expect(screen.getAllByText("declared").length).toBeGreaterThan(0);
    expect(screen.getAllByText("inferred").length).toBeGreaterThan(0);
    expect(screen.getByText(/No live traffic/)).toBeTruthy();
  });

  it("opens a node's drawer on click", () => {
    rows.set("v1/services", [{ metadata: { name: "api" }, spec: { selector: { app: "api" } } }]);
    render1();
    fireEvent.click(screen.getByRole("button", { name: "api" }));
    expect(navigate).toHaveBeenCalledWith("/detail/services/shop/api");
  });

  it("hides inferred edges on request", () => {
    rows.set("v1/services", [{ metadata: { name: "api" }, spec: { selector: { app: "api" } } }]);
    rows.set("v1/pods", [{ metadata: { name: "api-1", labels: { app: "api" } } }]);
    render1();
    expect(screen.getByTestId("edge-count").textContent).toBe("1");
    fireEvent.click(screen.getByLabelText(/inferred/i));
    expect(screen.getByTestId("edge-count").textContent).toBe("0");
  });

  it("shows findings chips for a Service with no ready endpoints and a route to a missing Service", () => {
    rows.set("v1/services", [{ metadata: { name: "api" }, spec: { selector: { app: "api" } } }]);
    rows.set("networking.k8s.io/v1/ingresses", [{ metadata: { name: "web" }, spec: { defaultBackend: { service: { name: "ghost" } } } }]);
    render1();
    expect(screen.getByText(/Service api has no ready endpoints/)).toBeTruthy();
    expect(screen.getByText(/Ingress web points at Service ghost/)).toBeTruthy();
  });

  it("follows Gateway API and Istio kinds only when their CRDs exist", async () => {
    render1();
    expect(streamCalls.filter((c) => c.gvr.includes("httproutes")).length).toBe(0);
    crds = [{ group: "gateway.networking.k8s.io", resource: "httproutes", gvr: "gateway.networking.k8s.io/v1/httproutes" }];
    render1();
    await screen.findAllByText(/Nothing to map/);
    await vi.waitFor(() => expect(streamCalls.some((c) => c.gvr === "gateway.networking.k8s.io/v1/httproutes" && c.enabled)).toBe(true));
  });

  it("shows a finding for a cross-namespace route backend no ReferenceGrant permits, once ReferenceGrants are read", async () => {
    crds = [
      { group: "gateway.networking.k8s.io", resource: "httproutes", gvr: "gateway.networking.k8s.io/v1/httproutes" },
      { group: "gateway.networking.k8s.io", resource: "referencegrants", gvr: "gateway.networking.k8s.io/v1beta1/referencegrants" },
    ];
    rows.set("gateway.networking.k8s.io/v1/httproutes", [{ metadata: { name: "r", namespace: "shop" }, spec: { rules: [{ backendRefs: [{ name: "pg", namespace: "data" }] }] } }]);
    render1();
    expect(await screen.findByText(/HTTPRoute r in shop points at Service pg in data/)).toBeTruthy();
  });

  it("hides cross-namespace lines with the toggle", () => {
    rows.set("v1/services", [{ metadata: { name: "api" }, spec: {} }]);
    rows.set("apps/v1/deployments", [{ metadata: { name: "web" }, spec: { template: { spec: { containers: [{ env: [{ name: "DB", value: "pg.data.svc" }] }] } } } }]);
    render1();
    expect(screen.getByTestId("edge-count").textContent).toBe("1");
    expect(screen.getByRole("button", { name: "pg" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/other namespaces/i));
    expect(screen.getByTestId("edge-count").textContent).toBe("0");
    expect(screen.queryByRole("button", { name: "pg" })).toBeNull();
  });

  it("on All namespaces it subscribes without a namespace filter and groups nodes by namespace", () => {
    rows.set("v1/services", [
      { metadata: { name: "api", namespace: "a" }, spec: {} },
      { metadata: { name: "api", namespace: "b" }, spec: {} },
    ]);
    render1(ALL_NAMESPACES);
    expect(streamNs.every((n) => n === undefined)).toBe(true);
    expect(screen.getAllByRole("button", { name: "api" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "a" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "b" })).toBeTruthy();
  });

  it("on All namespaces says when it shows only the first nodes and to narrow by namespace", () => {
    rows.set("v1/services", Array.from({ length: 450 }, (_, i) => ({ metadata: { name: `s${i}`, namespace: `n${i % 5}` }, spec: {} })));
    render1(ALL_NAMESPACES);
    expect(screen.getByText(/showing the first 400 of 450/i)).toBeTruthy();
    expect(screen.getByText(/narrow by namespace/i)).toBeTruthy();
  });

  it("offers observed traffic only when a Prometheus is found, and asks it nothing until ticked", async () => {
    rows.set("v1/services", [{ metadata: { name: "api" }, spec: {} }]);
    render1();
    expect(screen.queryByLabelText(/observed traffic/i)).toBeNull();
    cleanup();
    promSource = "auto";
    render1();
    const box = await screen.findByLabelText(/observed traffic/i);
    expect(promQueries).toEqual([]);
    fireEvent.click(box);
    expect(await screen.findByText(/No traffic metrics found/)).toBeTruthy();
  });

  it("draws an observed edge with its rate, query and time when istio_requests_total exists", async () => {
    promSource = "manual";
    const istio = OBSERVED_PROBES[0]!;
    promSamples = {
      [istio.presenceQuery]: [{ metric: {}, value: [1, "3"] }],
      [istio.rateQuery("shop")]: [
        { metric: { source_workload: "web", source_workload_namespace: "shop", destination_workload: "api", destination_workload_namespace: "shop" }, value: [1700000000, "2.5"] },
      ],
    };
    rows.set("apps/v1/deployments", [
      { metadata: { name: "web" }, spec: { replicas: 1 }, status: { readyReplicas: 1 } },
      { metadata: { name: "api" }, spec: { replicas: 1 }, status: { readyReplicas: 1 } },
    ]);
    render1();
    fireEvent.click(await screen.findByLabelText(/observed traffic/i));
    expect(await screen.findByText(/istio_requests_total/)).toBeTruthy();
    await vi.waitFor(() => expect(screen.getByTestId("edge-count").textContent).toBe("1"));
  });

  it("on All namespaces runs one cluster-wide query per metric and draws a cross-namespace observed edge", async () => {
    promSource = "auto";
    const [istio, nginx] = OBSERVED_PROBES;
    promSamples = {
      [istio!.presenceQuery]: [{ metric: {}, value: [1, "3"] }],
      [nginx!.presenceQuery]: [{ metric: {}, value: [1, "2"] }],
      [istio!.clusterRateQuery(OBSERVED_SERIES_CAP)]: [
        { metric: { source_workload: "web", source_workload_namespace: "a", destination_workload: "api", destination_workload_namespace: "b" }, value: [1700000000, "2.5"] },
      ],
    };
    rows.set("apps/v1/deployments", [
      { metadata: { name: "web", namespace: "a" }, spec: { replicas: 1 }, status: { readyReplicas: 1 } },
      { metadata: { name: "api", namespace: "b" }, spec: { replicas: 1 }, status: { readyReplicas: 1 } },
    ]);
    render1(ALL_NAMESPACES);
    fireEvent.click(await screen.findByLabelText(/observed traffic/i));
    await vi.waitFor(() => expect(screen.getByTestId("edge-count").textContent).toBe("1"));
    expect(promQueries.filter((q) => !q.startsWith("count("))).toEqual([istio!.clusterRateQuery(OBSERVED_SERIES_CAP), nginx!.clusterRateQuery(OBSERVED_SERIES_CAP)]);
    expect(screen.getByText(/observed from istio_requests_total at .*topk/)).toBeTruthy();
    // Cross-namespace observed lines follow the "other namespaces" toggle.
    fireEvent.click(screen.getByLabelText(/other namespaces/i));
    expect(screen.getByTestId("edge-count").textContent).toBe("0");
  });

  it("on All namespaces says when the series were capped", async () => {
    promSource = "auto";
    const istio = OBSERVED_PROBES[0]!;
    promSamples = {
      [istio.presenceQuery]: [{ metric: {}, value: [1, "3"] }],
      [istio.clusterRateQuery(OBSERVED_SERIES_CAP)]: Array.from({ length: OBSERVED_SERIES_CAP + 1 }, (_, i) => ({
        metric: { source_workload: `s${i}`, source_workload_namespace: "a", destination_workload: "d", destination_workload_namespace: "b" },
        value: [1, String(i + 1)],
      })),
    };
    rows.set("v1/services", [{ metadata: { name: "api", namespace: "a" }, spec: {} }]);
    render1(ALL_NAMESPACES);
    fireEvent.click(await screen.findByLabelText(/observed traffic/i));
    expect(await screen.findByText(new RegExp(`top ${OBSERVED_SERIES_CAP} series of istio_requests_total`, "i"))).toBeTruthy();
  });
});
