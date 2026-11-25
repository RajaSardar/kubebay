import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ArgoCD from "../ArgoCD";
import { argoCDApi } from "../../lib/api";

let clusterId = "kind-test";
vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: clusterId, setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  const app = { name: "web", namespace: "argocd", project: "default", repoURL: "", targetRevision: "", syncStatus: "Synced", healthStatus: "Healthy", lastSyncTime: "", message: "", resources: [] };
  return { ...actual, argoCDApi: { apps: vi.fn(async () => ({ installed: true, apps: [app] })), sync: vi.fn(async () => ({ ok: true })) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ArgoCD />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  clusterId = "kind-test";
  (argoCDApi.sync as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe("Argo CD page actions", () => {
  it("offers Rollback next to Hard Sync", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "Rollback" })).toBeInTheDocument();
  });

  it("hard sync on a non-production cluster needs the usual two clicks only", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Hard Sync" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm hard sync?" }));
    await waitFor(() => expect(argoCDApi.sync).toHaveBeenCalledTimes(1));
  });

  it("hard sync on a production-looking cluster asks once more, naming it", async () => {
    clusterId = "prod-eu";
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Hard Sync" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm hard sync?" }));
    expect(argoCDApi.sync).not.toHaveBeenCalled();
    expect(screen.getByText(/looks like a production cluster/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply to prod-eu" }));
    await waitFor(() => expect(argoCDApi.sync).toHaveBeenCalledTimes(1));
  });
});
