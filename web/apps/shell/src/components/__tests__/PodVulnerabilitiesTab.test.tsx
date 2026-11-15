import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { VulnFindingsSummary, PodVulnerabilitiesTab } from "../PodVulnerabilitiesTab";
import type { VulnFinding } from "../../lib/vulnFindings";
import { crdApi } from "../../lib/api";

function finding(overrides: Partial<VulnFinding> = {}): VulnFinding {
  return { id: "CVE-2024-1", severity: "HIGH", container: "nginx", reportName: "web-abc-nginx", ...overrides };
}

describe("VulnFindingsSummary", () => {
  it("shows an empty state when there are no findings", () => {
    render(<VulnFindingsSummary findings={[]} />);
    expect(screen.getByText(/no vulnerability findings/i)).toBeTruthy();
  });

  it("shows Critical and High findings by default", () => {
    render(<VulnFindingsSummary findings={[finding({ id: "CVE-crit", severity: "CRITICAL" }), finding({ id: "CVE-high", severity: "HIGH" })]} />);
    expect(screen.getByText("CVE-crit")).toBeTruthy();
    expect(screen.getByText("CVE-high")).toBeTruthy();
  });

  it("hides Medium/Low/Unknown findings behind a 'show all' disclosure", () => {
    render(<VulnFindingsSummary findings={[finding({ id: "CVE-crit", severity: "CRITICAL" }), finding({ id: "CVE-low", severity: "LOW" })]} />);
    expect(screen.queryByText("CVE-low")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    expect(screen.getByText("CVE-low")).toBeTruthy();
  });

  it("shows the report's scan timestamp so a stale finding isn't mistaken for live", () => {
    render(<VulnFindingsSummary findings={[finding({ severity: "CRITICAL", updatedAt: "2026-09-01T00:00:00Z" })]} />);
    expect(screen.getByText(/2026-09-01/)).toBeTruthy();
  });

  it("shows installed vs fixed version when known", () => {
    render(<VulnFindingsSummary findings={[finding({ severity: "CRITICAL", installedVersion: "1.2.3", fixedVersion: "1.2.4" })]} />);
    expect(screen.getByText(/1\.2\.3/)).toBeTruthy();
    expect(screen.getByText(/1\.2\.4/)).toBeTruthy();
  });
});

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

function renderTab(props: Partial<Parameters<typeof PodVulnerabilitiesTab>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/"]}>
        <PodVulnerabilitiesTab
          cluster="kind-test"
          ns="team-a"
          podName="web-abc-xyz"
          containers={["nginx"]}
          podObj={{ metadata: { ownerReferences: [{ kind: "ReplicaSet", name: "web-abc", controller: true }] } }}
          {...props}
        />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PodVulnerabilitiesTab — detection (backlog #16)", () => {
  it("offers to install Trivy-Operator, distinctly from a clean scan, when it isn't detected", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(vi.mocked(crdApi.list)).toHaveBeenCalled());
    expect(await screen.findByText(/trivy-operator not detected/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /install trivy-operator/i })).toBeTruthy();
    // Never a broken subscription: no findings text implying a scan ran.
    expect(screen.queryByText(/no vulnerability findings/i)).toBeNull();
  });

  it("shows the real clean-scan empty state, not the install prompt, once Trivy-Operator is detected", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([
      { name: "vulnerabilityreports.aquasecurity.github.io", group: "aquasecurity.github.io", version: "v1alpha1", resource: "vulnerabilityreports", kind: "VulnerabilityReport", namespaced: true, gvr: "aquasecurity.github.io/v1alpha1/vulnerabilityreports", columns: [] },
    ]);
    renderTab();
    await waitFor(() => expect(vi.mocked(crdApi.list)).toHaveBeenCalled());
    expect(await screen.findByText(/no vulnerability findings/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install trivy-operator/i })).toBeNull();
  });
});

// Root backlog #16: the CVEs themselves are on the Vulnerabilities page; the tab counts them and links there.
describe("PodVulnerabilitiesTab — on the Vulnerabilities page", () => {
  it("counts the findings and links to them on the Vulnerabilities page, rather than listing them", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([{ name: "vulnerabilityreports.aquasecurity.github.io", group: "aquasecurity.github.io", version: "v1alpha1", resource: "vulnerabilityreports", kind: "VulnerabilityReport", namespaced: true, gvr: "aquasecurity.github.io/v1alpha1/vulnerabilityreports", columns: [] }]);
    stream.rows = [
      {
        metadata: {
          name: "web-abc-nginx",
          labels: {
            "trivy-operator.resource.kind": "ReplicaSet",
            "trivy-operator.resource.name": "web-abc",
            "trivy-operator.resource.namespace": "team-a",
            "trivy-operator.container.name": "nginx",
          },
        },
        report: { vulnerabilities: [{ vulnerabilityID: "CVE-2024-1", severity: "CRITICAL" }, { vulnerabilityID: "CVE-2024-2", severity: "LOW" }] },
      },
    ];
    renderTab();
    expect(await screen.findByText(/1 critical · 0 high · 0 medium · 1 low/)).toBeTruthy();
    expect(screen.queryByText("CVE-2024-1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open on the Vulnerabilities page" }));
    expect(screen.getByTestId("at").textContent).toBe("/vulnerabilities?workload=team-a/ReplicaSet/web-abc");
    stream.rows = [];
  });
});
