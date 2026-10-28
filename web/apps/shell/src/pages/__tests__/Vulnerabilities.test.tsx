import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Vulnerabilities from "../Vulnerabilities";
import { crdApi } from "../../lib/api";

// Root backlog #16: every CVE on one page, rather than a tab on each pod and workload.

const VULN_GVR = "aquasecurity.github.io/v1alpha1/vulnerabilityreports";
const vulnCrd = {
  name: "vulnerabilityreports.aquasecurity.github.io", group: "aquasecurity.github.io", version: "v1alpha1",
  resource: "vulnerabilityreports", kind: "VulnerabilityReport", namespaced: true, gvr: VULN_GVR, columns: [],
};

function report(ns: string, ownerKind: string, ownerName: string, container: string, image: string, vulns: { id: string; severity: string; pkg?: string; fixedVersion?: string }[]) {
  const [repository, tag] = image.split(":");
  return {
    metadata: {
      name: `${ownerName}-${container}`,
      namespace: ns,
      labels: {
        "trivy-operator.resource.kind": ownerKind,
        "trivy-operator.resource.name": ownerName,
        "trivy-operator.resource.namespace": ns,
        "trivy-operator.container.name": container,
      },
    },
    report: {
      updateTimestamp: "2026-10-27T08:00:00Z",
      artifact: { repository, tag },
      vulnerabilities: vulns.map((v) => ({ vulnerabilityID: v.id, severity: v.severity, resource: v.pkg, fixedVersion: v.fixedVersion })),
    },
  };
}

const reports = [
  report("shop", "ReplicaSet", "web-7f9c", "nginx", "nginx:1.25", [
    { id: "CVE-2024-0001", severity: "CRITICAL", pkg: "openssl", fixedVersion: "3.0.2" },
    { id: "CVE-2024-0002", severity: "HIGH", pkg: "curl" },
    { id: "CVE-2024-0003", severity: "LOW", pkg: "zlib" },
  ]),
  report("shop", "StatefulSet", "db", "postgres", "postgres:16", [{ id: "CVE-2024-0004", severity: "MEDIUM", pkg: "glibc" }]),
  report("ops", "DaemonSet", "agent", "agent", "agent:2", [
    { id: "CVE-2024-0005", severity: "CRITICAL" },
    { id: "CVE-2024-0006", severity: "CRITICAL" },
  ]),
];
const replicaSets = [{ metadata: { name: "web-7f9c", namespace: "shop", ownerReferences: [{ kind: "Deployment", name: "web", controller: true }] } }];

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));
vi.mock("../../components/NamespaceFilter", () => ({ NamespaceFilter: () => null }));
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string, gvr: string) => ({
    rows: gvr === VULN_GVR ? reports : gvr === "apps/v1/replicasets" ? replicaSets : [],
    synced: true,
    connected: true,
  })),
  shouldShowSkeleton: () => false,
}));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  crdApi: { list: vi.fn() },
}));

function renderPage(path = "/vulnerabilities") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Vulnerabilities />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const workloadNames = () =>
  screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0]!.textContent);

describe("Vulnerabilities", () => {
  beforeEach(() => vi.mocked(crdApi.list).mockResolvedValue([vulnCrd]));

  it("lists every workload with findings, worst first, a Deployment for its ReplicaSet's reports", async () => {
    renderPage();
    await screen.findByRole("table");
    expect(workloadNames()).toEqual(["agent", "web", "db"]);
    const web = screen.getAllByRole("row").find((r) => within(r).queryByText("web"))!;
    // Kind, namespace, then Critical, High, Medium, Low, fixable.
    expect(within(web).getByText("Deployment")).toBeInTheDocument();
    expect(within(web).getAllByRole("cell").map((c) => c.textContent)).toEqual(expect.arrayContaining(["shop", "1", "1", "0", "1"]));
    expect(screen.getByRole("heading", { name: /Vulnerabilities/ })).toHaveTextContent("3 workloads");
  });

  it("filters by workload, image, CVE or package", async () => {
    renderPage();
    await screen.findByRole("table");
    const filter = screen.getByRole("textbox", { name: "Filter vulnerabilities" });
    fireEvent.change(filter, { target: { value: "postgres" } });
    expect(workloadNames()).toEqual(["db"]);
    fireEvent.change(filter, { target: { value: "CVE-2024-0002" } });
    expect(workloadNames()).toEqual(["web"]);
    fireEvent.change(filter, { target: { value: "openssl" } });
    expect(workloadNames()).toEqual(["web"]);
  });

  it("opens a workload's CVEs in a drawer, Critical and High first", async () => {
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByText("web"));
    const drawer = screen.getByRole("dialog", { name: "web" });
    expect(within(drawer).getByText("CVE-2024-0001")).toBeInTheDocument();
    expect(within(drawer).getByText("CVE-2024-0002")).toBeInTheDocument();
    expect(within(drawer).queryByText("CVE-2024-0003")).toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: /show all/i }));
    expect(within(drawer).getByText("CVE-2024-0003")).toBeInTheDocument();
  });

  it("opens the workload a link names, even by its ReplicaSet", async () => {
    renderPage("/vulnerabilities?workload=shop/ReplicaSet/web-7f9c");
    expect(await screen.findByRole("dialog", { name: "web" })).toBeInTheDocument();
  });

  it("offers to install Trivy-Operator when it isn't on the cluster", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Trivy-Operator not detected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /install trivy-operator/i })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
