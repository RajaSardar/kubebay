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
  it("offers to install Trivy-Operator, distinctly from a clean scan, when it isn't detected", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(vi.mocked(crdApi.list)).toHaveBeenCalled());
    expect(await screen.findByText(/trivy-operator not detected/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /install trivy-operator/i })).toBeTruthy();
    expect(screen.queryByText(/no vulnerability findings/i)).toBeNull();
  });

  it("still offers to install (no crash) for a StatefulSet, which needs no ReplicaSet lookup", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([]);
    renderTab({ kind: "StatefulSet", name: "db" });
    expect(await screen.findByText(/trivy-operator not detected/i)).toBeTruthy();
  });

  it("shows the real clean-scan empty state for this workload, not the install prompt, once detected", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([
      { name: "vulnerabilityreports.aquasecurity.github.io", group: "aquasecurity.github.io", version: "v1alpha1", resource: "vulnerabilityreports", kind: "VulnerabilityReport", namespaced: true, gvr: "aquasecurity.github.io/v1alpha1/vulnerabilityreports", columns: [] },
    ]);
    renderTab();
    await waitFor(() => expect(vi.mocked(crdApi.list)).toHaveBeenCalled());
    expect(await screen.findByText(/no vulnerability findings for this workload/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install trivy-operator/i })).toBeNull();
  });
});
