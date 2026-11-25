import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UpgradeImpactPanel } from "../UpgradeImpactPanel";
import type { PdbDrainFinding } from "../../lib/upgradePdb";
import type { SkewFinding } from "../../lib/upgradeSkew";
import type { WebhookFinding } from "../../lib/upgradeWebhooks";

const pdb: PdbDrainFinding = {
  ns: "shop", name: "web-pdb", reason: "no-disruptions", nodes: ["n1", "n2"], workloads: [{ kind: "Deployment", name: "web" }],
  podCount: 2, detail: "It allows 0 voluntary disruptions.", suggestion: "Loosen the budget.",
};
const skew: SkewFinding = { kind: "kubelet-too-old", node: "old-1", component: "kubelet", afterTarget: false, detail: "old-1 runs kubelet v1.26.0.", why: "Too far behind." };
const hook: WebhookFinding = {
  kind: "no-ready-endpoints", configKind: "ValidatingWebhookConfiguration", config: "policy", webhook: "p.example.com",
  failurePolicy: "Fail", detail: "Service sys/svc has no ready endpoints.", why: "Requests are rejected.",
};

const renderPanel = (p: Partial<React.ComponentProps<typeof UpgradeImpactPanel>> = {}) =>
  render(
    <MemoryRouter>
      <UpgradeImpactPanel pdbs={[pdb]} skew={[skew]} webhooks={[hook]} {...p} />
    </MemoryRouter>,
  );

describe("UpgradeImpactPanel", () => {
  it("lists PDB blockers with their nodes, workloads and suggestion", () => {
    renderPanel();
    expect(screen.getByText("web-pdb")).toBeTruthy();
    expect(screen.getByText(/n1, n2/)).toBeTruthy();
    expect(screen.getByText("web")).toBeTruthy();
    expect(screen.getByText(/loosen the budget/i)).toBeTruthy();
  });
  it("lists skew and webhook findings with why they matter", () => {
    renderPanel();
    expect(screen.getByText(/old-1 runs kubelet/)).toBeTruthy();
    expect(screen.getByText(/too far behind/i)).toBeTruthy();
    expect(screen.getByText("policy")).toBeTruthy();
    expect(screen.getByText(/requests are rejected/i)).toBeTruthy();
  });
  it("says each clear section is clear", () => {
    renderPanel({ pdbs: [], skew: [], webhooks: [] });
    expect(screen.getByText(/no pdb would block a drain/i)).toBeTruthy();
    expect(screen.getByText(/versions are within the skew policy/i)).toBeTruthy();
    expect(screen.getByText(/no admission webhook looks risky/i)).toBeTruthy();
  });
  it("says so when a section could not be read", () => {
    renderPanel({ pdbs: undefined, skew: undefined, webhooks: undefined });
    expect(screen.getAllByText(/couldn't be read/i)).toHaveLength(3);
  });
});
