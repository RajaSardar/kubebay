import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Keda from "../Keda";

// Root backlog #24 and #25: the KEDA page lists each KEDA kind in the same
// table as a CRD's own page (the filter language, namespace filter, columns,
// row menu and drawer), with a Paused column and KEDA's own checks as columns.

const now = new Date().toISOString();
const SO = "keda.sh/v1alpha1/scaledobjects";
const SJ = "keda.sh/v1alpha1/scaledjobs";
const TA = "keda.sh/v1alpha1/triggerauthentications";
const CTA = "keda.sh/v1alpha1/clustertriggerauthentications";
const HPA = "autoscaling/v2/horizontalpodautoscalers";

const rows: Record<string, Record<string, unknown>[]> = {
  [SO]: [
    {
      metadata: { name: "api-scale", namespace: "shop", creationTimestamp: now, annotations: { "autoscaling.keda.sh/paused-replicas": "0" } },
      spec: { scaleTargetRef: { name: "api" }, minReplicaCount: 1, maxReplicaCount: 10, triggers: [{ type: "cpu", authenticationRef: { name: "vault" } }] },
    },
    {
      metadata: { name: "worker-scale", namespace: "shop", creationTimestamp: now },
      spec: { scaleTargetRef: { name: "worker", kind: "Deployment" }, minReplicaCount: 0, maxReplicaCount: 5, triggers: [{ type: "kafka" }] },
    },
  ],
  [SJ]: [{ metadata: { name: "nightly", namespace: "data", creationTimestamp: now, annotations: { "autoscaling.keda.sh/paused": "true" } }, spec: {} }],
  [TA]: [
    { metadata: { name: "vault", namespace: "shop", creationTimestamp: now } },
    { metadata: { name: "old-auth", namespace: "shop", creationTimestamp: now } },
  ],
  [CTA]: [{ metadata: { name: "aws", creationTimestamp: now } }],
  [HPA]: [{ metadata: { name: "worker-hpa", namespace: "shop" }, spec: { scaleTargetRef: { name: "worker", kind: "Deployment" } } }],
};

let installed = true;
vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return {
    ...actual,
    useResourceStream: (_c: string | undefined, gvr: string) => ({ rows: rows[gvr] ?? [], synced: true, connected: true }),
  };
});
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  const crd = (resource: string, namespaced: boolean, columns: { name: string; jsonPath: string; type: string }[] = []) => ({
    name: `${resource}.keda.sh`,
    group: "keda.sh",
    version: "v1alpha1",
    resource,
    kind: resource,
    namespaced,
    gvr: `keda.sh/v1alpha1/${resource}`,
    columns,
  });
  return {
    ...actual,
    crdApi: {
      list: vi.fn(async () =>
        installed
          ? [
              crd("scaledobjects", true, [
                { name: "Min", jsonPath: ".spec.minReplicaCount", type: "integer" },
                { name: "Paused", jsonPath: '.status.conditions[?(@.type=="Paused")].status', type: "string" },
              ]),
              crd("scaledjobs", true),
              crd("triggerauthentications", true),
              crd("clustertriggerauthentications", false),
            ]
          : [],
      ),
    },
  };
});
vi.mock("../../components/GenericDrawer", () => ({
  default: (p: { def: { label: string }; name: string }) => (
    <div role="dialog" aria-label={p.name}>
      {p.def.label} drawer
    </div>
  ),
}));

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function renderKeda(at = "/keda") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/keda" element={<Keda />} />
          <Route path="*" element={<Where />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const names = () => [...document.querySelectorAll("tbody tr[data-index] .td-name")].map((td) => td.textContent);
const filter = (text: string) =>
  fireEvent.change(screen.getByRole("textbox", { name: /^Filter/ }), { target: { value: text } });
const cellOf = (row: string, header: string) => {
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
  const tr = screen.getByText(row).closest("tr")!;
  return tr.querySelectorAll("td")[headers.indexOf(header)]!;
};

describe("KEDA page", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => {
    localStorage.clear();
    installed = true;
  });

  it("has a tab per KEDA kind, ScaledObjects first", async () => {
    renderKeda();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["ScaledObjects", "ScaledJobs", "TriggerAuthentications", "ClusterTriggerAuthentications"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("lists ScaledObjects with Target, Paused and HPA conflict, and the CRD's own columns", async () => {
    renderKeda();
    await screen.findByRole("columnheader", { name: "Min" });
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Name", "Namespace", "Target", "Paused", "HPA conflict", "Min", "Age"]));
    // KEDA's own Paused printer column gives way to the one that reads the annotations.
    expect(headers.filter((h) => h === "Paused")).toHaveLength(1);
    expect(cellOf("api-scale", "Paused")).toHaveTextContent("Yes, at 0 replicas");
    expect(cellOf("worker-scale", "Paused")).toHaveTextContent("No");
    expect(cellOf("worker-scale", "HPA conflict")).toHaveTextContent("Yes");
    expect(cellOf("api-scale", "HPA conflict")).toHaveTextContent("No");
    expect(cellOf("api-scale", "Target")).toHaveTextContent("Deployment/api");
  });

  it("searches like any resource table, by name and by its columns", async () => {
    renderKeda();
    await screen.findByRole("columnheader", { name: "Paused" });
    filter("paused:yes");
    expect(names()).toEqual(["api-scale"]);
    filter("hpa-conflict:yes");
    expect(names()).toEqual(["worker-scale"]);
    filter("worker");
    expect(names()).toEqual(["worker-scale"]);
  });

  it("links a ScaledObject's target, and opens the ScaledObject's drawer from its row", async () => {
    renderKeda();
    await screen.findByRole("columnheader", { name: "Target" });
    fireEvent.click(screen.getByText("api-scale"));
    expect(screen.getByRole("dialog", { name: "api-scale" })).toHaveTextContent("ScaledObjects drawer");
    fireEvent.click(within(cellOf("api-scale", "Target") as HTMLElement).getByText("Deployment/api"));
    expect(screen.getAllByTestId("where").at(-1)).toHaveTextContent("/detail/deployments/shop/api");
  });

  it("says how many ScaledObjects fight an HPA, and shows them", async () => {
    renderKeda();
    const banner = await screen.findByText(/1 ScaledObject is also scaled by an HPA/);
    fireEvent.click(within(banner.closest(".inline-banner") as HTMLElement).getByRole("button", { name: "Show them" }));
    expect(screen.getByRole("textbox", { name: /^Filter/ })).toHaveValue("hpa-conflict:yes");
    expect(names()).toEqual(["worker-scale"]);
  });

  it("shows ScaledJobs with their Paused column", async () => {
    renderKeda("/keda?tab=scaledjobs");
    await screen.findByRole("columnheader", { name: "Paused" });
    expect(cellOf("nightly", "Paused")).toHaveTextContent("Yes");
  });

  it("says which TriggerAuthentications no ScaledObject uses", async () => {
    renderKeda();
    fireEvent.click(await screen.findByRole("tab", { name: "TriggerAuthentications" }));
    await screen.findByRole("columnheader", { name: "In use" });
    expect(cellOf("vault", "In use")).toHaveTextContent("Yes (1)");
    expect(cellOf("old-auth", "In use")).toHaveTextContent("No");
    filter("in-use:no");
    expect(names()).toEqual(["old-auth"]);
    expect(screen.getAllByTestId("where").at(-1)).toHaveTextContent("tab=triggerauthentications");
  });

  it("lists ClusterTriggerAuthentications without a Namespace column", async () => {
    renderKeda("/keda?tab=clustertriggerauthentications");
    await screen.findByText("aws");
    expect(screen.queryByRole("columnheader", { name: "Namespace" })).toBeNull();
    expect(cellOf("aws", "In use")).toHaveTextContent("No");
  });

  it("says when KEDA isn't installed", async () => {
    installed = false;
    renderKeda();
    expect(await screen.findByText("KEDA not detected on this cluster.")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });
});
