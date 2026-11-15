import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Rbac, { ruleAllows } from "../Rbac";
import * as attackPaths from "../../lib/attackPaths";
import { useResourceStream } from "../../lib/useResourceStream";
import { rbacApi } from "../../lib/api";

vi.mock("../../lib/attackPaths", async (orig) => {
  const m = await orig<typeof import("../../lib/attackPaths")>();
  return { ...m, findAttackPaths: vi.fn(m.findAttackPaths) };
});

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string, gvr: string) => ({
    rows: gvr === "v1/secrets" ? [{ metadata: { name: "old-creds", namespace: "shop" } }] : [],
    synced: true,
  })),
  shouldShowSkeleton: () => false,
}));

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  rbacApi: {
    all: vi.fn(async () => ({ roles: [], clusterRoles: [], roleBindings: [], clusterRoleBindings: [], findings: [] })),
  },
  crdApi: {
    list: vi.fn(async () => [
      { group: "gateway.networking.k8s.io", resource: "httproutes", gvr: "gateway.networking.k8s.io/v1/httproutes", kind: "HTTPRoute", version: "v1", scope: "Namespaced" },
      { group: "config.ratify.deislabs.io", resource: "verifiers", gvr: "config.ratify.deislabs.io/v1beta1/verifiers", kind: "Verifier", version: "v1beta1", scope: "Cluster" },
      { group: "constraints.gatekeeper.sh", resource: "ratifyverification", gvr: "constraints.gatekeeper.sh/v1beta1/ratifyverification", kind: "RatifyVerification", version: "v1beta1", scope: "Cluster" },
    ]),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Rbac />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Rbac", () => {
  it("streams Secrets in metadata mode only, so Secret values never reach the shell", () => {
    renderPage();
    const secretCalls = vi.mocked(useResourceStream).mock.calls.filter(([, g]) => g === "v1/secrets");
    expect(secretCalls.length).toBeGreaterThan(0);
    for (const [, , opts] of secretCalls) expect((opts as { mode?: string } | undefined)?.mode).toBe("metadata");
  });

  it("lists Secrets nothing references", async () => {
    renderPage();
    expect(await screen.findByText("old-creds")).toBeInTheDocument();
  });

  it("lists ServiceAccounts no pod or workload runs as, counting DaemonSet templates", async () => {
    const rows: Record<string, unknown[]> = {
      "v1/serviceaccounts": [
        { metadata: { name: "old-bot", namespace: "shop" } },
        { metadata: { name: "node-agent", namespace: "shop" } },
      ],
      "apps/v1/daemonsets": [{ metadata: { name: "agent", namespace: "shop" }, spec: { template: { spec: { serviceAccountName: "node-agent" } } } }],
    };
    vi.mocked(useResourceStream).mockImplementation(((_c: string, gvr: string) => ({ rows: rows[gvr] ?? [], synced: true })) as typeof useResourceStream);
    renderPage();
    expect(await screen.findByText("old-bot")).toBeInTheDocument();
    expect(screen.queryByText("node-agent")).toBeNull();
  });

  it("offers an on-demand signature check of the images actually running", async () => {
    renderPage();
    expect(await screen.findByText("Running image signatures")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check signatures" })).toBeInTheDocument();
  });

  it("offers a findings report export (KB-15)", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "Export report" })).toBeInTheDocument();
  });

  it("offers the audit-log security feed", async () => {
    renderPage();
    expect(await screen.findByText("Audit-log security events")).toBeInTheDocument();
  });

  it("chains an exposed workload to its ServiceAccount's risky RBAC", async () => {
    const rows: Record<string, unknown[]> = {
      "v1/pods": [{ metadata: { name: "api-1", namespace: "shop", labels: { app: "api" } }, spec: { serviceAccountName: "api", containers: [{ name: "app" }] } }],
      "v1/services": [{ metadata: { name: "api", namespace: "shop" }, spec: { type: "LoadBalancer", selector: { app: "api" } } }],
    };
    vi.mocked(useResourceStream).mockImplementation(((_c: string, gvr: string) => ({ rows: rows[gvr] ?? [], synced: true })) as typeof useResourceStream);
    vi.mocked(rbacApi.all).mockResolvedValueOnce({
      roles: [], clusterRoles: [], roleBindings: [], clusterRoleBindings: [],
      findings: [{ severity: "high", title: "Can read Secrets cluster-wide", subject: "ServiceAccount shop/api", roleRef: "ClusterRole/x", why: "" }],
    });
    renderPage();
    expect(await screen.findByText("Pod shop/api-1")).toBeInTheDocument();
    expect(screen.getByText(/Mounts the shop\/api ServiceAccount token/)).toBeInTheDocument();
  });

  it("feeds signature coverage the namespaces, Ratify constraints and validating webhooks", async () => {
    renderPage();
    await screen.findByText("Image signature verification");
    await vi.waitFor(() => {
      const calls = vi.mocked(useResourceStream).mock.calls;
      const enabled = (gvr: string) => calls.some(([, g, o]) => g === gvr && (o as { enabled?: boolean } | undefined)?.enabled !== false);
      expect(enabled("constraints.gatekeeper.sh/v1beta1/ratifyverification")).toBe(true);
      expect(enabled("admissionregistration.k8s.io/v1/validatingwebhookconfigurations")).toBe(true);
      expect(enabled("v1/namespaces")).toBe(true);
    });
  });

  it("feeds attack paths the Gateway API routes and namespace labels", async () => {
    renderPage();
    await screen.findByText("Attack paths");
    await vi.waitFor(() => {
      const calls = vi.mocked(useResourceStream).mock.calls;
      const enabled = (gvr: string) => calls.some(([, g, o]) => g === gvr && (o as { enabled?: boolean } | undefined)?.enabled !== false);
      expect(enabled("gateway.networking.k8s.io/v1/httproutes")).toBe(true);
      expect(enabled("v1/namespaces")).toBe(true);
    });
  });
});

describe("ruleAllows", () => {
  it("does not throw on a nonResourceURLs-only rule, which the API sends with null apiGroups and resources", () => {
    const rule = { verbs: ["get"], apiGroups: null, resources: null, nonResourceURLs: ["/healthz"] } as never;
    expect(ruleAllows(rule, "get", "", "secrets")).toBe(false);
  });

  it("still matches an ordinary rule", () => {
    expect(ruleAllows({ verbs: ["get"], apiGroups: [""], resources: ["secrets"] } as never, "get", "", "secrets")).toBe(true);
  });
});

describe("Rbac under a busy stream", () => {
  it("does not redo the attack-path analysis on every flush of the streams it reads", async () => {
    const spy = vi.mocked(attackPaths.findAttackPaths);
    // Every render hands back fresh rows, as a stream does on each 16 ms flush.
    vi.mocked(useResourceStream).mockImplementation(((_c: string, gvr: string) => ({
      rows: gvr === "v1/pods" ? [{ metadata: { name: `p${Math.random()}`, namespace: "shop" } }] : [],
      synced: true,
    })) as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Rbac />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(tree());
    await screen.findByText("Who can …");
    spy.mockClear();
    for (let i = 0; i < 20; i++) rerender(tree());
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
