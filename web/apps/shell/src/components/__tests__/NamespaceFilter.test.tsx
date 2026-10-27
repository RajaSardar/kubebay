import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NamespaceFilter } from "../NamespaceFilter";
import { useNamespaceStore } from "../../lib/namespace-store";
import { useClusterMeta } from "../../lib/cluster-meta-store";

const stream = vi.hoisted(() => ({ rows: [] as unknown[], forbidden: undefined as string | undefined }));
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: () => ({ rows: stream.rows, synced: !stream.forbidden, forbidden: stream.forbidden }),
}));

const ns = (name: string, project?: string) => ({
  metadata: { name, annotations: project ? { "field.cattle.io/projectId": `c-m-abc12:${project}` } : {} },
});

function renderFilter(cluster: string, clusters: unknown[] = [{ id: cluster }]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["clusters"], clusters);
  return render(
    <QueryClientProvider client={qc}>
      <NamespaceFilter cluster={cluster} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  stream.rows = [];
  stream.forbidden = undefined;
  useNamespaceStore.setState({ selections: {} });
  useClusterMeta.setState({ meta: {} });
});

describe("NamespaceFilter", () => {
  it("groups namespaces by Rancher project when the cluster has projects (KB-08)", () => {
    stream.rows = [ns("shop", "p-b"), ns("kube-system"), ns("api", "p-b"), ns("cattle-system", "p-a")];
    renderFilter("prod");
    fireEvent.click(screen.getByRole("button", { name: /All namespaces/ }));
    const b = screen.getByRole("group", { name: "Project p-b" });
    expect(within(b).getAllByRole("option").map((o) => o.textContent)).toEqual(["api", "shop"]);
    expect(within(screen.getByRole("group", { name: "Not in a project" })).getByRole("option", { name: /kube-system/ })).toBeInTheDocument();
  });

  it("stays a flat list without projects", () => {
    stream.rows = [ns("b"), ns("a")];
    renderFilter("dev");
    fireEvent.click(screen.getByRole("button", { name: /All namespaces/ }));
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option").slice(1).map((o) => o.textContent)).toEqual(["a", "b"]);
  });
});

// ADR 0003: when RBAC won't list namespaces, the picker offers the ones the
// person named (the context's, then typed ones) and never claims "All".
describe("NamespaceFilter when namespaces can't be listed", () => {
  const reason = 'namespaces is forbidden: User "dev" cannot list resource "namespaces" in API group "" at the cluster scope';
  beforeEach(() => {
    stream.forbidden = reason;
  });

  it("offers the named namespaces, says why, and has no All namespaces", () => {
    useNamespaceStore.getState().setNamespaces("limited", ["shop"]);
    renderFilter("limited", [{ id: "limited", namespace: "shop" }]);
    fireEvent.click(screen.getByRole("button", { name: "shop" }));
    expect(screen.getAllByRole("option")).toEqual([screen.getByRole("option", { name: /shop/, selected: true })]);
    expect(screen.queryByRole("option", { name: /All namespaces/ })).toBeNull();
    expect(screen.getByText("You can't list namespaces on this cluster. Showing the ones you named.")).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it("asks for a namespace instead of claiming All when none is named", () => {
    renderFilter("limited", [{ id: "limited" }]);
    expect(screen.queryByText("All namespaces")).toBeNull();
    expect(screen.getByRole("button", { name: /Name a namespace/ })).toBeInTheDocument();
  });

  it("adds a typed namespace, remembers it for the cluster and selects it", () => {
    useNamespaceStore.getState().setNamespaces("limited", ["shop"]);
    renderFilter("limited", [{ id: "limited", namespace: "shop" }]);
    fireEvent.click(screen.getByRole("button", { name: "shop" }));
    const field = screen.getByRole("textbox", { name: "Add a namespace" });
    fireEvent.change(field, { target: { value: "payments" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useClusterMeta.getState().meta.limited?.namespaces).toEqual(["payments"]);
    expect(useNamespaceStore.getState().selections.limited).toEqual(["shop", "payments"]);
    expect(screen.getByRole("option", { name: /payments/ })).toBeInTheDocument();
  });

  it("refuses a name that can't be a namespace", () => {
    renderFilter("limited", [{ id: "limited", namespace: "shop" }]);
    fireEvent.click(screen.getByRole("button", { name: /Name a namespace|shop/ }));
    const field = screen.getByRole("textbox", { name: "Add a namespace" });
    fireEvent.change(field, { target: { value: "Shop!" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useClusterMeta.getState().meta.limited?.namespaces).toBeUndefined();
    expect(screen.getByText(/isn't a namespace name/)).toBeInTheDocument();
  });

  it("forgets a typed namespace", () => {
    useClusterMeta.getState().rememberNamespace("limited", "payments");
    useNamespaceStore.getState().setNamespaces("limited", ["shop", "payments"]);
    renderFilter("limited", [{ id: "limited", namespace: "shop" }]);
    fireEvent.click(screen.getByRole("button", { name: "2 namespaces" }));
    fireEvent.click(screen.getByRole("button", { name: "Forget payments" }));
    expect(useClusterMeta.getState().meta.limited?.namespaces).toEqual([]);
    expect(useNamespaceStore.getState().selections.limited).toEqual(["shop"]);
  });

  it("keeps at least one namespace selected", () => {
    useNamespaceStore.getState().setNamespaces("limited", ["shop"]);
    renderFilter("limited", [{ id: "limited", namespace: "shop" }]);
    fireEvent.click(screen.getByRole("button", { name: "shop" }));
    fireEvent.click(screen.getByRole("option", { name: /shop/ }));
    expect(useNamespaceStore.getState().selections.limited).toEqual(["shop"]);
  });
});
