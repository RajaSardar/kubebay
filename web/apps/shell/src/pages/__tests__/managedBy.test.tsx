import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { CellLink, NsPill } from "@kubebay/ui";
import ResourceTable from "../ResourceTable";
import ArgoCD from "../ArgoCD";
import { FluxSummary } from "../../components/FluxSummary";

// #23 part 2: the GitOps owner column reads "Managed by" and links to the
// Argo CD / Flux page at that app, which shows it; namespace pills work from
// the keyboard (docs/TABLE_FOLLOWUPS.md).

const now = new Date().toISOString();
const deployments = [
  { metadata: { name: "web", namespace: "shop", creationTimestamp: now, annotations: { "argocd.argoproj.io/instance": "storefront" } }, spec: {}, status: {} },
  { metadata: { name: "api", namespace: "shop", creationTimestamp: now, annotations: { "kustomize.toolkit.fluxcd.io/name": "apps" } }, spec: {}, status: {} },
];

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return { ...actual, useResourceStream: () => ({ rows: deployments, synced: true, connected: true }) };
});
const app = (name: string) => ({
  name, namespace: "argocd", project: "default", repoURL: "", targetRevision: "", syncStatus: "Synced",
  healthStatus: "Healthy", lastSyncTime: "", message: "", resources: [],
});
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, argoCDApi: { ...actual.argoCDApi, apps: vi.fn(async () => ({ installed: true, apps: [app("storefront"), app("billing")] })) } };
});

let where = "";
function Where() {
  const l = useLocation();
  where = l.pathname + l.search;
  return null;
}
function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/r/:kind" element={<ResourceTable />} />
          <Route path="/argocd" element={<ArgoCD />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Managed by", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });

  it("CellLink is a real link; NsPill works from the keyboard when it does something", () => {
    const go = vi.fn();
    render(
      <>
        <CellLink href="/argocd?app=x">x</CellLink>
        <NsPill onClick={go}>shop</NsPill>
        <NsPill>data</NsPill>
      </>,
    );
    expect(screen.getByRole("link", { name: "x" })).toHaveAttribute("href", "/argocd?app=x");
    expect(screen.getByRole("link", { name: "x" })).toHaveClass("cell-link");
    const pill = screen.getByRole("button", { name: "shop" });
    expect(pill).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(pill, { key: "Enter" });
    fireEvent.keyDown(pill, { key: " " });
    expect(go).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "data" })).toBeNull();
  });

  it("the column reads Managed by and links to the app's Argo CD or Flux page", () => {
    renderAt("/r/deployments");
    expect(screen.getByRole("columnheader", { name: "Managed by" })).toBeInTheDocument();
    const argo = screen.getByRole("link", { name: "Argo CD: storefront" });
    expect(argo).toHaveAttribute("href", "/argocd?app=storefront");
    expect(screen.getByRole("link", { name: "Flux: apps" })).toHaveAttribute("href", "/flux?name=apps");
    fireEvent.click(argo);
    expect(where).toBe("/argocd?app=storefront");
  });

  it("the Argo CD page marks the linked app, or says it is not there", async () => {
    renderAt("/argocd?app=storefront");
    const row = (await screen.findByText("storefront")).closest("tr")!;
    expect(row).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("billing").closest("tr")).not.toHaveAttribute("aria-current");
  });

  it("the Argo CD page says when the linked app is missing", async () => {
    renderAt("/argocd?app=nope");
    expect(await screen.findByText(/Application nope isn.t in this cluster/)).toBeInTheDocument();
  });

  it("the Flux summary marks the linked object, or says it is not there", () => {
    const item = { kind: "Kustomization", name: "apps", ns: "flux-system", ready: true, readyMessage: "", managedResourceCount: 3, driftEventCount: 0 };
    const { rerender } = render(<FluxSummary items={[item as never]} highlight="apps" />);
    expect(screen.getByText("apps").closest(".kb-card")).toHaveClass("kb-card-selected");
    rerender(<FluxSummary items={[item as never]} highlight="nope" />);
    expect(screen.getByText(/nope isn.t in this cluster/)).toBeInTheDocument();
    within(document.body);
  });
});
