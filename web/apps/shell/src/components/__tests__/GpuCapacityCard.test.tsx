import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GpuCapacityCard } from "../GpuCapacityCard";
import type { GpuCapacity } from "../../lib/gpuCapacity";

const empty: GpuCapacity = { nodes: [], totals: [], pods: [], pending: [] };

describe("GpuCapacityCard", () => {
  it("renders nothing for a cluster without GPU nodes", () => {
    const { container } = render(<GpuCapacityCard gpu={empty} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows unclaimed GPUs per resource and the per-node split", () => {
    render(
      <GpuCapacityCard
        gpu={{
          ...empty,
          nodes: [{ node: "g1", resource: "nvidia.com/gpu", allocatable: 4, requested: 3 }],
          totals: [{ resource: "nvidia.com/gpu", allocatable: 4, requested: 3, idle: 1 }],
        }}
      />,
    );
    expect(screen.getByText("1 of 4 nvidia.com/gpu unclaimed")).toBeInTheDocument();
    expect(screen.getByText("g1")).toBeInTheDocument();
    expect(screen.getByText("3 / 4")).toBeInTheDocument();
  });

  it("lists pods waiting for a GPU", () => {
    render(
      <GpuCapacityCard
        gpu={{
          ...empty,
          totals: [{ resource: "nvidia.com/gpu", allocatable: 1, requested: 1, idle: 0 }],
          nodes: [{ node: "g1", resource: "nvidia.com/gpu", allocatable: 1, requested: 1 }],
          pending: [{ namespace: "ml", pod: "queued", node: "", resource: "nvidia.com/gpu", count: 2 }],
        }}
      />,
    );
    expect(screen.getByText(/1 pod waiting for a GPU/)).toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
  });
});
