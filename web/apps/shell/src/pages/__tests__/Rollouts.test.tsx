import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Rollouts from "../Rollouts";

// Why the Rollouts page seemed to miss Rollouts: it ignored the namespace
// filter, never said when RBAC refused a namespace, and counted before the
// list had synced.

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  crdApi: {
    list: vi.fn(async () => [
      { name: "rollouts.argoproj.io", group: "argoproj.io", version: "v1alpha1", resource: "rollouts", kind: "Rollout", namespaced: true, gvr: "argoproj.io/v1alpha1/rollouts", columns: [] },
    ]),
  },
}));
vi.mock("../../components/NamespaceFilter", () => ({ NamespaceFilter: () => <div>namespace filter</div> }));

const selected = vi.hoisted(() => ({ ns: [] as string[] }));
vi.mock("../../lib/namespace-store", () => ({ useSelectedNamespaces: () => selected.ns }));

type S = { rows: unknown[]; synced: boolean; connected: boolean; forbidden?: string; denied?: { ns: string; reason: string }[] };
const stream = vi.hoisted(() => ({ rollouts: { rows: [], synced: true, connected: true } as S, calls: [] as { gvr: string; ns?: string[] }[] }));
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: (_c: string, gvr: string, opts?: { ns?: string[] }) => {
    stream.calls.push({ gvr, ns: opts?.ns });
    return gvr === "argoproj.io/v1alpha1/rollouts" ? stream.rollouts : { rows: [], synced: true, connected: true };
  },
}));

const ro = (name: string, namespace: string) => ({ metadata: { name, namespace }, spec: {}, status: { phase: "Healthy" } });

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Rollouts />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  selected.ns = [];
  stream.calls = [];
  stream.rollouts = { rows: [], synced: true, connected: true };
});

describe("Rollouts page", () => {
  it("has the namespace filter and lists only the selected namespaces", async () => {
    selected.ns = ["shop", "infra"];
    stream.rollouts = { rows: [ro("web", "shop")], synced: true, connected: true };
    renderPage();
    expect(await screen.findByText("namespace filter")).toBeInTheDocument();
    const call = stream.calls.filter((c) => c.gvr === "argoproj.io/v1alpha1/rollouts").pop();
    expect(call?.ns).toEqual(["shop", "infra"]);
    const rs = stream.calls.filter((c) => c.gvr === "apps/v1/replicasets").pop();
    expect(rs?.ns).toEqual(["shop", "infra"]);
  });

  it("says when RBAC refuses the Rollout list instead of showing none", async () => {
    stream.rollouts = { rows: [], synced: false, connected: true, forbidden: "rollouts.argoproj.io is forbidden: cannot list" };
    renderPage();
    expect(await screen.findByText(/You can't list Rollouts/)).toBeInTheDocument();
    expect(screen.getByText(/cannot list/)).toBeInTheDocument();
    expect(screen.queryByText(/No Rollouts found/)).toBeNull();
  });

  it("names the namespaces RBAC refused while showing the rest", async () => {
    selected.ns = ["shop", "locked"];
    stream.rollouts = { rows: [ro("web", "shop")], synced: true, connected: true, denied: [{ ns: "locked", reason: "forbidden in locked" }] };
    renderPage();
    expect(await screen.findByText(/You can't list Rollouts in locked/)).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
  });

  it("shows no count and no empty state until the list has synced", async () => {
    stream.rollouts = { rows: [ro("web", "shop")], synced: false, connected: true };
    renderPage();
    expect(await screen.findByText("web")).toBeInTheDocument();
    expect(document.querySelector(".page-header-count")?.textContent ?? "").toBe("");
    expect(screen.queryByText(/No Rollouts found/)).toBeNull();
  });
});
