import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkloadVulnerabilitiesTab } from "../WorkloadVulnerabilitiesTab";
import { crdApi } from "../../lib/api";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, crdApi: { list: vi.fn() } };
});

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: () => ({ rows: [], synced: true, connected: true }),
}));

function renderTab(props: Partial<Parameters<typeof WorkloadVulnerabilitiesTab>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkloadVulnerabilitiesTab cluster="kind-test" ns="team-a" name="web" kind="Deployment" {...props} />
    </QueryClientProvider>,
  );
}

describe("WorkloadVulnerabilitiesTab — detection (backlog #16 Phase 2)", () => {
  it("shows an empty state, never a broken subscription, when Trivy-Operator isn't installed", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(vi.mocked(crdApi.list)).toHaveBeenCalled());
    expect(await screen.findByText(/no vulnerability findings/i)).toBeTruthy();
  });

  it("still renders (no crash) for a StatefulSet, which needs no ReplicaSet lookup", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([]);
    renderTab({ kind: "StatefulSet", name: "db" });
    expect(await screen.findByText(/no vulnerability findings/i)).toBeTruthy();
  });
});
