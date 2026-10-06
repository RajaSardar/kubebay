import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NamespaceSummary } from "../NamespaceSummary";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const streamData: Record<string, Record<string, unknown>[]> = {
  "v1/pods": [
    { metadata: { name: "web-abc" }, status: { phase: "Running" } },
    { metadata: { name: "web-def" }, status: { phase: "Running" } },
    { metadata: { name: "db-xyz" }, status: { phase: "Pending" } },
  ],
  "apps/v1/deployments": [
    { metadata: { name: "web" }, status: { readyReplicas: 2, replicas: 2 } },
    { metadata: { name: "api" }, status: { readyReplicas: 1, replicas: 3 } },
  ],
  "apps/v1/statefulsets": [
    { metadata: { name: "postgres" }, status: { readyReplicas: 1, replicas: 1 } },
  ],
  "v1/services": [
    { metadata: { name: "web-svc" }, spec: { type: "ClusterIP" } },
    { metadata: { name: "lb" }, spec: { type: "LoadBalancer" } },
  ],
  "v1/configmaps": [
    { metadata: { name: "app-config" } },
    { metadata: { name: "env-config" } },
  ],
  "v1/secrets": [
    { metadata: { name: "db-secret" } },
  ],
};

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: (_cluster: string, gvr: string) => ({
    rows: streamData[gvr] ?? [],
    synced: true,
  }),
}));

function render$(ns = "platform") {
  return render(
    <MemoryRouter>
      <NamespaceSummary cluster="kind-test" namespace={ns} />
    </MemoryRouter>,
  );
}

describe("NamespaceSummary — actual resource rows (backlog #2 extended)", () => {
  it("shows actual pod names, not just a count", () => {
    render$();
    expect(screen.getByText("web-abc")).toBeInTheDocument();
    expect(screen.getByText("web-def")).toBeInTheDocument();
    expect(screen.getByText("db-xyz")).toBeInTheDocument();
  });

  it("shows actual deployment names", () => {
    render$();
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
  });

  it("shows section headers with counts", () => {
    render$();
    expect(screen.getByText("Pods (3)")).toBeInTheDocument();
    expect(screen.getByText("Deployments (2)")).toBeInTheDocument();
    expect(screen.getByText("Services (2)")).toBeInTheDocument();
  });

  it("shows pod phase as a status indicator", () => {
    render$();
    expect(screen.getAllByTitle("Running").length).toBeGreaterThan(0);
  });

  it("clicking a section header navigates to the resource table filtered by namespace", () => {
    render$();
    fireEvent.click(screen.getByText("Deployments (2)"));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining("deployments"));
  });

  it("hides empty sections (StatefulSets with 1 item still shows)", () => {
    render$();
    expect(screen.getByText("StatefulSets (1)")).toBeInTheDocument();
    expect(screen.getByText("postgres")).toBeInTheDocument();
  });

  it("keeps the count testids for backwards compat", () => {
    render$();
    expect(screen.getByTestId("count-pods").textContent).toBe("3");
    expect(screen.getByTestId("count-deployments").textContent).toBe("2");
  });
});
