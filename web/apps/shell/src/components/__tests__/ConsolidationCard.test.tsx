import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConsolidationCard } from "../ConsolidationCard";
import type { ConsolidationResult, NodeConsolidation } from "../../lib/consolidation";

function n(node: string, over: Partial<NodeConsolidation>): NodeConsolidation {
  return {
    node, outcome: "drainable", allocatableCpuMillis: 4000, allocatableMemBytes: 16 * 1024 ** 3,
    requestedCpuMillis: 1000, requestedMemBytes: 4 * 1024 ** 3, podsToMove: 2, blockers: [], spof: [], ...over,
  };
}

const result: ConsolidationResult = {
  drainable: ["n1"],
  nodes: [
    n("n1", {}),
    n("n2", { outcome: "downtime", spof: [{ ns: "shop", name: "cart", workloadKind: "Deployment" }] }),
    n("n3", { outcome: "blocked", blockers: [{ kind: "pdb", ns: "db", pod: "pg-0", pdb: "pg-pdb" }, { kind: "no-room", ns: "db", pod: "pg-1" }] }),
    n("cp", { outcome: "skipped", skipReason: "control plane", podsToMove: 0 }),
  ],
};

describe("ConsolidationCard", () => {
  it("summarises how many nodes could be drained one after another, read-only", () => {
    render(<ConsolidationCard result={result} />);
    expect(screen.getByText("Node consolidation")).toBeInTheDocument();
    expect(screen.getByText("read-only")).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 nodes could be drained one after another/)).toBeInTheDocument();
  });

  it("explains each verdict: SPOF downtime, blockers, and skipped nodes", () => {
    render(<ConsolidationCard result={result} />);
    expect(screen.getByText("drain causes downtime")).toBeInTheDocument();
    expect(screen.getByText(/single replica, no PDB: shop\/Deployment\/cart/)).toBeInTheDocument();
    expect(screen.getByText(/PDB pg-pdb allows no disruptions \(db\/pg-0\)/)).toBeInTheDocument();
    expect(screen.getByText(/no room elsewhere \(db\/pg-1\)/)).toBeInTheDocument();
    expect(screen.getByText("control plane")).toBeInTheDocument();
  });

  it("says plainly when nothing can be drained", () => {
    render(<ConsolidationCard result={{ drainable: [], nodes: [n("n3", { outcome: "blocked", blockers: [{ kind: "bare-pod", ns: "x", pod: "y" }] })] }} />);
    expect(screen.getByText(/No node can be drained right now/)).toBeInTheDocument();
    expect(screen.getByText(/no controller, a drain deletes it \(x\/y\)/)).toBeInTheDocument();
  });
});
