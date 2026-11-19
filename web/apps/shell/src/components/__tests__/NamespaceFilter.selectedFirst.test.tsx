import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NamespaceFilter } from "../NamespaceFilter";
import { useNamespaceStore } from "../../lib/namespace-store";

const stream = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: () => ({ rows: stream.rows, synced: true, forbidden: undefined }),
}));

const ns = (name: string, project?: string) => ({
  metadata: { name, annotations: project ? { "field.cattle.io/projectId": `c-m-abc12:${project}` } : {} },
});

function open(cluster: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["clusters"], [{ id: cluster }]);
  render(
    <QueryClientProvider client={qc}>
      <NamespaceFilter cluster={cluster} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { expanded: false }));
}

beforeEach(() => {
  useNamespaceStore.setState({ selections: {} });
});

describe("NamespaceFilter selected first (backlog 55)", () => {
  it("lists selected namespaces right after All namespaces, then the rest", () => {
    stream.rows = [ns("a"), ns("b"), ns("c"), ns("d")];
    useNamespaceStore.getState().setNamespaces("dev", ["d", "b"]);
    open("dev");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All namespaces", "✓b", "✓d", "a", "c"]);
  });

  it("puts a Selected group first when the cluster has projects", () => {
    stream.rows = [ns("shop", "p-b"), ns("api", "p-b"), ns("kube-system")];
    useNamespaceStore.getState().setNamespaces("prod", ["kube-system"]);
    open("prod");
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Selected", "Project p-b"]);
    expect(within(groups[0]!).getAllByRole("option").map((o) => o.textContent)).toEqual(["✓kube-system"]);
    expect(within(groups[1]!).getAllByRole("option").map((o) => o.textContent)).toEqual(["api", "shop"]);
  });

  it("search still filters the selected ones", () => {
    stream.rows = [ns("a1"), ns("b1"), ns("b2")];
    useNamespaceStore.getState().setNamespaces("dev", ["b2", "a1"]);
    open("dev");
    fireEvent.change(screen.getByPlaceholderText("Search namespaces…"), { target: { value: "b" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All namespaces", "✓b2", "b1"]);
  });
});
