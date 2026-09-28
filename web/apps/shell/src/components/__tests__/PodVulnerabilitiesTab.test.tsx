import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: () => ({ rows: [], synced: true, connected: true }),
}));

function renderTab(props: Partial<Parameters<typeof PodVulnerabilitiesTab>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PodVulnerabilitiesTab
        cluster="kind-test"
        ns="team-a"
        podName="web-abc-xyz"
        containers={["nginx"]}
        podObj={{ metadata: { ownerReferences: [{ kind: "ReplicaSet", name: "web-abc", controller: true }] } }}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("PodVulnerabilitiesTab — detection (backlog #16)", () => {
  it("shows an empty state, never a broken subscription, when Trivy-Operator isn't installed", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(vi.mocked(crdApi.list)).toHaveBeenCalled());
    expect(await screen.findByText(/no vulnerability findings/i)).toBeTruthy();
  });
});
