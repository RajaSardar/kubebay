import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const forbidden = new Map<string, string>();
const rows = new Map<string, unknown[]>();
const navigate = vi.fn();

vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string, gvr: string) => ({ rows: rows.get(gvr) ?? [], synced: !forbidden.has(gvr), connected: true, forbidden: forbidden.get(gvr) })),
}));
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, edges, onNodeClick }: { nodes: { id: string; data: { kb: { name: string } } }[]; edges: unknown[]; onNodeClick: (e: unknown, n: { id: string }) => void }) => (
    <div>
      <span data-testid="edge-count">{edges.length}</span>
      {nodes.map((n) => (
        <button key={n.id} onClick={(e) => onNodeClick(e, n)}>
          {n.data.kb.name}
        </button>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  BackgroundVariant: {},
  Position: {},
}));

const { default: ServiceMapView } = await import("../ServiceMapView");

const render1 = () =>
  render(
    <MemoryRouter>
      <ServiceMapView cluster="c1" namespace="shop" />
    </MemoryRouter>,
  );

describe("ServiceMapView", () => {
  beforeEach(() => {
    forbidden.clear();
    rows.clear();
    navigate.mockClear();
  });

  it("says what it can't list when a stream is forbidden", () => {
    forbidden.set("networking.k8s.io/v1/ingresses", 'ingresses is forbidden: User "dev" cannot list resource "ingresses"');
    render1();
    expect(screen.getByText(/can't list ingresses/i)).toBeTruthy();
  });

  it("says the namespace has nothing to map when it is empty", () => {
    render1();
    expect(screen.getByText(/Nothing to map in "shop"/)).toBeTruthy();
  });

  it("explains that edges are declared or inferred, never observed traffic", () => {
    rows.set("v1/services", [{ metadata: { name: "api" }, spec: { selector: { app: "api" } } }]);
    render1();
    expect(screen.getAllByText("declared").length).toBeGreaterThan(0);
    expect(screen.getAllByText("inferred").length).toBeGreaterThan(0);
    expect(screen.getByText(/No live traffic/)).toBeTruthy();
  });

  it("opens a node's drawer on click", () => {
    rows.set("v1/services", [{ metadata: { name: "api" }, spec: { selector: { app: "api" } } }]);
    render1();
    fireEvent.click(screen.getByRole("button", { name: "api" }));
    expect(navigate).toHaveBeenCalledWith("/detail/services/shop/api");
  });

  it("hides inferred edges on request", () => {
    rows.set("v1/services", [{ metadata: { name: "api" }, spec: { selector: { app: "api" } } }]);
    rows.set("v1/pods", [{ metadata: { name: "api-1", labels: { app: "api" } } }]);
    render1();
    expect(screen.getByTestId("edge-count").textContent).toBe("1");
    fireEvent.click(screen.getByLabelText(/inferred/i));
    expect(screen.getByTestId("edge-count").textContent).toBe("0");
  });
});
