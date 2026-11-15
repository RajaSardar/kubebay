import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { WorkloadVulnerabilitiesTab } from "../WorkloadVulnerabilitiesTab";
import { crdApi } from "../../lib/api";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, crdApi: { list: vi.fn() } };
});

const stream = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: (_c: string, gvr: string) => ({ rows: gvr.includes("vulnerabilityreports") ? stream.rows : [], synced: true, connected: true }),
}));

function Where() {
  const l = useLocation();
  return <div data-testid="at">{l.pathname + decodeURIComponent(l.search)}</div>;
}

function renderTab(props: Partial<Parameters<typeof WorkloadVulnerabilitiesTab>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/"]}>
        <WorkloadVulnerabilitiesTab cluster="kind-test" ns="team-a" name="web" kind="Deployment" {...props} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
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

// Root backlog #16: the CVEs themselves are on the Vulnerabilities page; the tab counts them and links there.
describe("WorkloadVulnerabilitiesTab — on the Vulnerabilities page", () => {
  it("counts the findings and links to them on the Vulnerabilities page, rather than listing them", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([{ name: "vulnerabilityreports.aquasecurity.github.io", group: "aquasecurity.github.io", version: "v1alpha1", resource: "vulnerabilityreports", kind: "VulnerabilityReport", namespaced: true, gvr: "aquasecurity.github.io/v1alpha1/vulnerabilityreports", columns: [] }]);
    stream.rows = [
      {
        metadata: {
          name: "web-abc-nginx",
          labels: {
            "trivy-operator.resource.kind": "StatefulSet",
            "trivy-operator.resource.name": "web",
            "trivy-operator.resource.namespace": "team-a",
            "trivy-operator.container.name": "nginx",
          },
        },
        report: { vulnerabilities: [{ vulnerabilityID: "CVE-2024-1", severity: "CRITICAL" }, { vulnerabilityID: "CVE-2024-2", severity: "LOW" }] },
      },
    ];
    renderTab({ kind: "StatefulSet", name: "web" });
    expect(await screen.findByText(/1 critical · 0 high · 0 medium · 1 low/)).toBeTruthy();
    expect(screen.queryByText("CVE-2024-1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open on the Vulnerabilities page" }));
    expect(screen.getByTestId("at").textContent).toBe("/vulnerabilities?workload=team-a/StatefulSet/web");
    stream.rows = [];
  });
});
