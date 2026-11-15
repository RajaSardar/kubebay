import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FindingsExport } from "../FindingsExport";
import { api, discoveryApi, type RBACFinding } from "../../lib/api";

const stream = vi.hoisted(() => ({ synced: true }));
vi.mock("../../lib/useResourceStream", () => ({ useResourceStream: () => ({ rows: [], synced: stream.synced, connected: true }) }));
vi.mock("../../lib/useCluster", () => ({ useCluster: () => ({ cluster: "kind-dev", list: [{ id: "kind-dev", version: "v1.24.3" }] }) }));
vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, version: vi.fn() }, discoveryApi: { ...actual.discoveryApi, apiVersions: vi.fn() } };
});

const rbac: RBACFinding[] = [{ severity: "high", title: "Bound to the built-in cluster-admin role", subject: "ServiceAccount ci/deployer", roleRef: "ClusterRole:cluster-admin", why: "cluster-admin can do anything." }];
const rows = { pods: [], deployments: [], statefulSets: [], services: [], networkPolicies: [] };

function renderIt(ready = true) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FindingsExport cluster="kind-dev" ready={ready} findings={{ rbac, unenforcedSignatureNamespaces: ["shop"] }} rows={rows} />
    </QueryClientProvider>,
  );
}

describe("FindingsExport (KB-15)", () => {
  let saved: { name: string; blob: Blob }[];
  beforeEach(() => {
    stream.synced = true;
    saved = [];
    vi.mocked(api.version).mockReset().mockResolvedValue({ version: "v0.7.0" });
    // The cluster still serves policy/v1beta1, removed in 1.25: one upgrade finding.
    vi.mocked(discoveryApi.apiVersions).mockReset().mockResolvedValue(["v1", "policy/v1beta1"]);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      const call = vi.mocked(URL.createObjectURL).mock.calls.at(-1);
      saved.push({ name: this.download, blob: call?.[0] as Blob });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("gathers nothing until asked", () => {
    renderIt();
    expect(screen.getByRole("button", { name: "Export report" })).toBeInTheDocument();
    expect(discoveryApi.apiVersions).not.toHaveBeenCalled();
    expect(api.version).not.toHaveBeenCalled();
  });

  it("counts every detector's findings and saves SARIF, JSON and Markdown", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Export report" }));
    expect(await screen.findByText("3 findings, 2 high")).toBeInTheDocument();
    expect(screen.getByText("RBAC")).toBeInTheDocument();
    expect(screen.getByText("Upgrade readiness")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save SARIF" }));
    fireEvent.click(screen.getByRole("button", { name: "Save JSON" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Markdown" }));
    await waitFor(() => expect(saved).toHaveLength(3));
    expect(saved.map((s) => s.name)).toEqual([
      expect.stringMatching(/^kubebay-findings-kind-dev-\d{8}-\d{4}\.sarif$/),
      expect.stringMatching(/\.json$/),
      expect.stringMatching(/\.md$/),
    ]);
    const sarif = JSON.parse(await saved[0]!.blob.text());
    expect(sarif.runs[0].tool.driver.version).toBe("v0.7.0");
    expect(sarif.runs[0].properties.cluster).toBe("kind-dev");
    expect(sarif.runs[0].results.map((r: { ruleId: string }) => r.ruleId)).toContain("kubebay.upgrade.removed-api");
  });

  it("waits for the cluster's data before saving", async () => {
    stream.synced = false;
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Export report" }));
    expect(await screen.findByText(/Gathering findings/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save SARIF" })).toBeDisabled();
  });
});
