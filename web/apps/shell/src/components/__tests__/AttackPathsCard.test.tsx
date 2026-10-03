import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttackPathsCard } from "../AttackPathsCard";
import type { AttackPath } from "../../lib/attackPaths";

const path: AttackPath = {
  workload: { ns: "shop", kind: "Deployment", name: "api" },
  serviceAccount: "shop/api",
  entry: [{ via: "LoadBalancer", name: "api" }],
  ingressIsolated: false,
  isolatingPolicies: [],
  vulns: { critical: 1, high: 0 },
  tokenMounted: true,
  privileges: [{ title: "Can read Secrets cluster-wide", severity: "high", roleRef: "ClusterRole/x" }],
  nodeEscape: [],
  secretAccess: [],
  complete: true,
  score: 9,
  steps: ["Reachable from outside the cluster via LoadBalancer Service shop/api", "Runs images with 1 critical CVE"],
};

describe("AttackPathsCard", () => {
  it("shows each chain's workload, verdict and steps", () => {
    render(<AttackPathsCard paths={[path, { ...path, workload: { ...path.workload, name: "web" }, complete: false }]} trivyInstalled />);
    expect(screen.getByText(/2 paths start outside the cluster; 1 reaches both a vulnerable image and a payoff/)).toBeInTheDocument();
    expect(screen.getByText("Deployment shop/api")).toBeInTheDocument();
    expect(screen.getByText("full chain")).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.getAllByText("Runs images with 1 critical CVE")).toHaveLength(2);
  });

  it("says when there is nothing to chain", () => {
    render(<AttackPathsCard paths={[]} trivyInstalled />);
    expect(screen.getByText(/No workload reachable from outside the cluster/)).toBeInTheDocument();
  });

  it("says CVEs are left out when Trivy Operator isn't installed", () => {
    render(<AttackPathsCard paths={[]} trivyInstalled={false} />);
    expect(screen.getByText(/Trivy Operator isn't installed/)).toBeInTheDocument();
  });

  it("says where chains start and what counts as a payoff", () => {
    render(<AttackPathsCard paths={[]} trivyInstalled />);
    expect(screen.getByText(/Gateway API HTTPRoute/)).toBeInTheDocument();
    expect(screen.getByText(/break out to the node/)).toBeInTheDocument();
    expect(screen.getByText(/Secrets the token can read/)).toBeInTheDocument();
  });
});
