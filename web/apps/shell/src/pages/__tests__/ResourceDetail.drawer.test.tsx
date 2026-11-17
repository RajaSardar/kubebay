import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ResourceTable from "../ResourceTable";
import ResourceDetail from "../ResourceDetail";
import { DEFS } from "../../lib/resources";

// Backlog #34: a resource opens in the right-side drawer over its list, like a
// pod does, for every kind. /detail/... (deep links, cross-links, the palette)
// used to render the drawer as a full page.

const now = new Date().toISOString();
const obj = (ns: string, name: string) => ({ metadata: { name, namespace: ns, creationTimestamp: now }, spec: {}, status: {} });

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return { ...actual, useResourceStream: () => ({ rows: [obj("shop", "web")], synced: true, connected: true }) };
});
vi.mock("../../components/GenericDrawer", () => ({
  default: (p: { name: string; embedded?: boolean; onPopOut?: () => void; onClose: () => void }) => (
    <div data-testid="drawer" data-embedded={String(!!p.embedded)} data-popout={String(!!p.onPopOut)}>
      {p.name}
      <button onClick={p.onClose}>close-drawer</button>
    </div>
  ),
}));

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/r/:kind" element={<ResourceTable />} />
          <Route path="/detail/:kind/:ns/:name" element={<ResourceDetail />} />
          <Route path="/workloads" element={<div>pods-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SLUGS = Object.keys(DEFS).filter((s) => s !== "pods");

describe("every kind opens in the side drawer", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });

  it.each(SLUGS)("/detail/%s shows the list with a non-embedded drawer", (slug) => {
    renderAt(`/detail/${slug}/shop/web`);
    const d = screen.getByTestId("drawer");
    expect(d).toHaveAttribute("data-embedded", "false");
    expect(d).toHaveAttribute("data-popout", "false");
  });

  it("closing a deep-linked drawer returns to the kind's list", () => {
    renderAt("/detail/deployments/shop/web");
    fireEvent.click(screen.getByText("close-drawer"));
    expect(screen.getByTestId("where")).toHaveTextContent("/r/deployments");
    expect(screen.queryByTestId("drawer")).toBeNull();
  });

  it("a row click opens the drawer without leaving the list", () => {
    renderAt("/r/deployments");
    fireEvent.click(screen.getAllByText("web")[0]!);
    expect(screen.getByTestId("where")).toHaveTextContent("/r/deployments");
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-embedded", "false");
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-popout", "false");
  });

  it("a pod deep link goes to the pod panel", () => {
    renderAt("/detail/pods/shop/web");
    expect(screen.getByText("pods-page")).toBeInTheDocument();
  });
});
