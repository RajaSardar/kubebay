import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnusedServiceAccountsCard } from "./UnusedServiceAccountsCard";

describe("UnusedServiceAccountsCard", () => {
  it("shows an all-clear message when every ServiceAccount is in use", () => {
    render(<UnusedServiceAccountsCard accounts={[]} />);
    expect(screen.getByText(/every serviceaccount is used/i)).toBeTruthy();
  });

  it("lists each one with the bindings that grant it access and any long-lived token", () => {
    render(
      <UnusedServiceAccountsCard
        accounts={[
          { namespace: "shop", name: "ci", createdAt: "", bindings: ["ClusterRoleBinding ci-admin → ClusterRole:cluster-admin"], tokenSecrets: ["ci-token"] },
          { namespace: "shop", name: "old-bot", createdAt: "2026-01-01T00:00:00Z", bindings: [], tokenSecrets: [] },
        ]}
      />,
    );
    expect(screen.getByText("ci")).toBeTruthy();
    expect(screen.getByText("old-bot")).toBeTruthy();
    expect(screen.getByText("ClusterRoleBinding ci-admin → ClusterRole:cluster-admin")).toBeTruthy();
    expect(screen.getByText("ci-token")).toBeTruthy();
    expect(screen.getByText("1 with permissions")).toBeTruthy();
  });

  it("warns that tokens used from outside the cluster aren't visible", () => {
    render(<UnusedServiceAccountsCard accounts={[{ namespace: "shop", name: "x", createdAt: "", bindings: [], tokenSecrets: [] }]} />);
    expect(screen.getByText(/outside the cluster/i)).toBeTruthy();
  });
});
