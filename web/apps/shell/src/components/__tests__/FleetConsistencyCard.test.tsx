import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { FleetConsistencyCard } from "../FleetConsistencyCard";

const streamMock = vi.fn();
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: (...args: unknown[]) => streamMock(...args),
}));

function dep(image: string, extra: Record<string, string> = {}) {
  return {
    metadata: { name: "api", namespace: "shop" },
    spec: { replicas: 2, template: { spec: { containers: [{ name: "app", image, env: Object.entries(extra).map(([name, value]) => ({ name, value })) }] } } },
  };
}

const data: Record<string, Record<string, unknown[]>> = {
  eu: { "apps/v1/deployments": [dep("shop/api:1.4", { REGION: "eu" }), { metadata: { name: "worker", namespace: "shop" }, spec: {} }] },
  us: { "apps/v1/deployments": [dep("shop/api:1.3", { REGION: "us" })] },
};

beforeEach(() => {
  streamMock.mockReset();
  streamMock.mockImplementation((cluster: string | undefined, gvr: string, opts: { enabled?: boolean } = {}) => ({
    rows: cluster && opts.enabled !== false ? (data[cluster]?.[gvr] ?? []) : [],
    synced: !!cluster && opts.enabled !== false,
    connected: true,
  }));
});

describe("FleetConsistencyCard", () => {
  it("asks for a second cluster when only one is connected", () => {
    render(<FleetConsistencyCard clusters={["eu"]} />);
    expect(screen.getByText(/Connect at least two clusters/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare clusters" })).toBeNull();
  });

  it("opens no streams until the user asks to compare", () => {
    render(<FleetConsistencyCard clusters={["eu", "us"]} />);
    expect(screen.getByRole("button", { name: "Compare clusters" })).toBeInTheDocument();
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("shows each differing field with every cluster's value, image drift first", () => {
    render(<FleetConsistencyCard clusters={["eu", "us"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare clusters" }));

    expect(screen.getByText(/1 object in more than one cluster, 1 differs/)).toBeInTheDocument();
    const table = screen.getAllByRole("table")[0]!;
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("containers[app].image")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("shop/api:1.4")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("shop/api:1.3")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("containers[app].env.REGION")).toBeInTheDocument();
    expect(screen.getAllByText("Deployment shop/api")).toHaveLength(2);
  });

  it("lists objects missing from a cluster that has their namespace", () => {
    render(<FleetConsistencyCard clusters={["eu", "us"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare clusters" }));
    expect(screen.getByText("Deployment shop/worker")).toBeInTheDocument();
    expect(screen.getByText(/Only in some clusters/)).toBeInTheDocument();
  });
});
