import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Palette } from "../Palette";
import { useClusterStore } from "../../lib/cluster-store";
import { getClusterRows, getConnectedClusters } from "../../lib/clusterConnections";
import { useResourceStream } from "../../lib/useResourceStream";
import { api } from "../../lib/api";

vi.mock("../../lib/useResourceStream", () => ({ useResourceStream: vi.fn(() => ({ rows: [], synced: true, connected: true })) }));
vi.mock("../../lib/clusterConnections", () => ({
  getConnectedClusters: vi.fn(() => new Set(["prod"])),
  getClusterRows: vi.fn(() => []),
  subscribeConnections: () => () => {},
}));
vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, clusters: vi.fn(async () => []), pfList: vi.fn(async () => []) },
    historyApi: { ...actual.historyApi, enroll: vi.fn(async () => {}) },
  };
});

const obj = (name: string, ns?: string, extra: Record<string, unknown> = {}) => ({ metadata: { name, ...(ns ? { namespace: ns } : {}) }, ...extra });

// What each cluster's background streams hold; rebuilt for every test.
const fresh = (): Record<string, Record<string, Record<string, unknown>[]>> => ({
  prod: {
    "apps/v1/deployments": [obj("api", "shop"), obj("api-gateway", "shop"), obj("billing-worker", "billing")],
    "v1/pods": [obj("web-1", "shop", { status: { phase: "Running" }, spec: { containers: [{ name: "c" }] } })],
    "v1/nodes": [obj("ip-10-1-2-3")],
  },
  stage: { "apps/v1/deployments": [obj("api-stage", "shop")] },
});
let data = fresh();

function Where() {
  const l = useLocation();
  return <div data-testid="at">{l.pathname + l.search}</div>;
}

function renderPalette(open = true) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/"]}>
        <Palette open={open} onClose={() => {}} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const type = (v: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value: v } });

beforeEach(() => {
  data = fresh();
  localStorage.clear();
  useClusterStore.setState({ active: "prod" });
  vi.mocked(useResourceStream).mockClear();
  vi.mocked(getClusterRows).mockReset().mockImplementation((cluster, gvr) => data[cluster]?.[gvr] ?? []);
  vi.mocked(getConnectedClusters).mockReturnValue(new Set(["prod"]));
});

describe("Palette: search everything the app already holds", () => {
  it("does no work and opens no stream while it is closed", () => {
    renderPalette(false);
    expect(getClusterRows).not.toHaveBeenCalled();
    expect(useResourceStream).not.toHaveBeenCalled();
  });

  it("does not fetch the cluster or port-forward lists while it is closed", () => {
    vi.mocked(api.clusters).mockClear();
    vi.mocked(api.pfList).mockClear();
    renderPalette(false);
    expect(api.clusters).not.toHaveBeenCalled();
    expect(api.pfList).not.toHaveBeenCalled();
  });

  it("opens no stream of its own even when it is open", () => {
    renderPalette();
    type("api");
    expect(useResourceStream).not.toHaveBeenCalled();
  });

  it("finds Deployments by name, grouped by kind, and opens the object itself", () => {
    renderPalette();
    type("api");
    expect(screen.getByText("Deployments")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^api in shop/ }));
    expect(screen.getByTestId("at").textContent).toBe("/detail/deployments/shop/api");
  });

  it("opens a pod in the Pods list with its drawer open", () => {
    renderPalette();
    type("web-1");
    fireEvent.click(screen.getByRole("button", { name: /web-1/ }));
    expect(screen.getByTestId("at").textContent).toBe("/workloads?pod=shop%2Fweb-1");
  });

  it("opens a cluster-scoped object with an empty namespace", () => {
    renderPalette();
    type("ip-10");
    fireEvent.click(screen.getByRole("button", { name: /ip-10-1-2-3/ }));
    expect(screen.getByTestId("at").textContent).toBe("/detail/nodes/_/ip-10-1-2-3");
  });

  it("limits to one kind with a kind word and a space", () => {
    renderPalette();
    type("deploy api");
    expect(screen.queryByText("Pods")).toBeNull();
    expect(screen.getByRole("button", { name: /api-gateway/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /billing-worker/ })).toBeNull();
  });

  it("offers 'show all' when a kind has more matches than rows, and opens the filtered list", () => {
    data.prod!["apps/v1/deployments"] = Array.from({ length: 12 }, (_, i) => obj(`svc-${i}`, "shop"));
    renderPalette();
    type("svc");
    fireEvent.click(screen.getByRole("button", { name: /show all 12/i }));
    expect(screen.getByTestId("at").textContent).toBe("/r/deployments?q=svc");
  });

  it("remembers what you opened and lists it when the box is empty", () => {
    const { unmount } = renderPalette();
    type("api-gateway");
    fireEvent.click(screen.getByRole("button", { name: /api-gateway/ }));
    unmount();
    renderPalette();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /api-gateway/ })).toBeInTheDocument();
  });
});

describe("Palette: scope", () => {
  beforeEach(() => {
    vi.mocked(getConnectedClusters).mockReturnValue(new Set(["prod", "stage"]));
  });

  it("searches only the active cluster until you widen it", () => {
    renderPalette();
    type("api");
    expect(screen.queryByRole("button", { name: /api-stage/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "All clusters" }));
    expect(screen.getByRole("button", { name: /api-stage/ })).toBeInTheDocument();
  });

  it("names the cluster on a hit from another one, and switches to it when opened", () => {
    renderPalette();
    fireEvent.click(screen.getByRole("radio", { name: "All clusters" }));
    type("api-stage");
    const hit = screen.getByRole("button", { name: /api-stage/ });
    expect(within(hit).getByText("stage")).toBeInTheDocument();
    fireEvent.click(hit);
    expect(useClusterStore.getState().active).toBe("stage");
    expect(screen.getByTestId("at").textContent).toBe("/detail/deployments/shop/api-stage");
  });

  it("shows no scope switch when only one cluster is connected", () => {
    vi.mocked(getConnectedClusters).mockReturnValue(new Set(["prod"]));
    renderPalette();
    expect(screen.queryByRole("radio", { name: "All clusters" })).toBeNull();
  });
});
