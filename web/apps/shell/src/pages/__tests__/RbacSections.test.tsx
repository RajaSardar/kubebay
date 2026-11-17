import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Rbac from "../Rbac";
import * as attackPaths from "../../lib/attackPaths";
import { rbacApi } from "../../lib/api";

vi.mock("../../lib/attackPaths", async (orig) => {
  const m = await orig<typeof import("../../lib/attackPaths")>();
  return { ...m, findAttackPaths: vi.fn(m.findAttackPaths) };
});
vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn(() => ({ rows: [], synced: true })),
  shouldShowSkeleton: () => false,
}));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  rbacApi: {
    all: vi.fn(async () => ({
      roles: [{ name: "pod-reader", ns: "shop", kind: "Role", rules: [{ verbs: ["get", "list"], apiGroups: [""], resources: ["pods"], resourceNames: ["web"] }] }],
      clusterRoles: [
        { name: "cluster-admin", kind: "ClusterRole", rules: [{ verbs: ["*"], apiGroups: ["*"], resources: ["*"] }, { verbs: ["get"], apiGroups: null, resources: null, nonResourceURLs: ["/healthz"] }] },
        { name: "viewer", kind: "ClusterRole", rules: [{ verbs: ["get"], apiGroups: ["apps"], resources: ["deployments"] }] },
      ],
      roleBindings: [{ name: "rb", ns: "shop", kind: "RoleBinding", roleRef: "Role:pod-reader", subjects: [{ kind: "ServiceAccount", name: "bot", ns: "shop" }] }],
      clusterRoleBindings: [{ name: "crb", kind: "ClusterRoleBinding", roleRef: "ClusterRole:cluster-admin", subjects: [{ kind: "Group", name: "ops" }] }],
      findings: [],
    })),
  },
  crdApi: { list: vi.fn(async () => []) },
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
const head = (name: RegExp) => screen.getByRole("button", { name });

describe("Rbac collapsible sections", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(attackPaths.findAttackPaths).mockClear();
  });

  it("opens only the who-can query and summary; heavy sections start collapsed", async () => {
    renderPage();
    await screen.findByText("Who can …");
    expect(head(/^Who can/)).toHaveAttribute("aria-expanded", "true");
    expect(head(/^Summary/)).toHaveAttribute("aria-expanded", "true");
    for (const n of [/^Attack paths/, /^Findings/, /^Roles and their access/]) expect(head(n)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Check signatures" })).toBeNull();
    expect(screen.queryByPlaceholderText(/Filter roles/)).toBeNull();
  });

  it("does not run the attack-path analysis until that section is opened", async () => {
    renderPage();
    await screen.findByText("Who can …");
    expect(attackPaths.findAttackPaths).not.toHaveBeenCalled();
    fireEvent.click(head(/^Attack paths/));
    expect(attackPaths.findAttackPaths).toHaveBeenCalled();
  });

  it("remembers each section's open state", async () => {
    const first = renderPage();
    await screen.findByText("Who can …");
    fireEvent.click(head(/^Findings/));
    fireEvent.click(head(/^Summary/));
    first.unmount();
    renderPage();
    await screen.findByText("Who can …");
    expect(head(/^Findings/)).toHaveAttribute("aria-expanded", "true");
    expect(head(/^Summary/)).toHaveAttribute("aria-expanded", "false");
    expect(head(/^Attack paths/)).toHaveAttribute("aria-expanded", "false");
  });

  it("lists roles with a count, filters by name, and shows rules and subjects", async () => {
    renderPage();
    await screen.findByText("Who can …");
    expect(within(head(/^Roles and their access/)).getByText("3")).toBeInTheDocument();
    fireEvent.click(head(/^Roles and their access/));
    expect(screen.getByText("cluster-admin")).toBeInTheDocument();
    expect(screen.getByText("pod-reader")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Filter roles/), { target: { value: "cluster-ad" } });
    expect(screen.queryByText("pod-reader")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /cluster-admin/ }));
    expect(screen.getAllByText("*").length).toBeGreaterThan(0);
    expect(screen.getByText("/healthz")).toBeInTheDocument();
    expect(screen.getByText("Group ops")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Filter roles/), { target: { value: "pod-reader" } });
    fireEvent.click(screen.getByRole("button", { name: /pod-reader/ }));
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("SA shop/bot")).toBeInTheDocument();
  });

  it("shows 50 roles then a Show more button", async () => {
    vi.mocked(rbacApi.all).mockResolvedValueOnce({
      roles: [], roleBindings: [], clusterRoleBindings: [], findings: [],
      clusterRoles: Array.from({ length: 60 }, (_, i) => ({ name: `r${String(i).padStart(2, "0")}`, kind: "ClusterRole", rules: [] })),
    });
    renderPage();
    await screen.findByText("Who can …");
    fireEvent.click(head(/^Roles and their access/));
    expect(screen.queryByText("r55")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show more/ }));
    expect(screen.getByText("r55")).toBeInTheDocument();
  });
});
