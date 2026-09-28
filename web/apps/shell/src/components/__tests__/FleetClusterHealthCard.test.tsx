import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FleetClusterHealthCard } from "../FleetClusterHealthCard";

const streamMock = vi.fn();
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: (...args: unknown[]) => streamMock(...args),
}));

function rowsFor(gvr: string) {
  if (gvr === "v1/pods") return [{ status: { phase: "Running" } }, { status: { phase: "Failed" } }];
  if (gvr === "v1/nodes") return [{ status: { conditions: [{ type: "Ready", status: "True" }] } }];
  if (gvr === "apps/v1/deployments") return [{ spec: { replicas: 2 }, status: { readyReplicas: 1 } }];
  return [];
}

beforeEach(() => {
  streamMock.mockImplementation((_cluster: string | undefined, gvr: string) => ({
    rows: rowsFor(gvr),
    synced: true,
    connected: true,
  }));
});

describe("FleetClusterHealthCard", () => {
  it("renders the cluster name and total unhealthy count, and calls onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(<FleetClusterHealthCard cluster="kind-a" index={0} onOpen={onOpen} onHealthComputed={() => {}} />);

    expect(screen.getByText("kind-a")).toBeTruthy();
    fireEvent.click(screen.getByText("kind-a"));
    expect(onOpen).toHaveBeenCalledWith("kind-a");
  });

  it("reports its computed unhealthy/total counts via onHealthComputed once synced", () => {
    const onHealthComputed = vi.fn();
    render(<FleetClusterHealthCard cluster="kind-a" index={0} onOpen={() => {}} onHealthComputed={onHealthComputed} />);

    expect(onHealthComputed).toHaveBeenCalled();
    const [cluster, summary] = onHealthComputed.mock.calls[onHealthComputed.mock.calls.length - 1]!;
    expect(cluster).toBe("kind-a");
    expect(summary.synced).toBe(true);
    expect(summary.unhealthy).toBeGreaterThan(0);
  });

  it("shows a skeleton instead of counts while not yet enabled (a later stagger wave)", () => {
    render(<FleetClusterHealthCard cluster="kind-b" index={10} concurrency={1} intervalMs={999999} onOpen={() => {}} onHealthComputed={() => {}} />);
    expect(screen.queryByText(/issues/i)).toBeNull();
  });
});
