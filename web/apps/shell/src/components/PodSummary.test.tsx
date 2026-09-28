import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PodSummary } from "./PodSummary";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("./PodEnvValue", () => ({
  PodEnvValue: ({ envVar }: { envVar: { name: string } }) => <span data-testid={`env-${envVar.name}`}>resolved</span>,
}));

function renderSummary(obj: Record<string, unknown>) {
  return render(
    <MemoryRouter>
      <PodSummary obj={obj} cluster="kind-a" />
    </MemoryRouter>,
  );
}

const basePod = {
  metadata: { name: "web-1", namespace: "prod", uid: "abc-123" },
  spec: {
    nodeName: "node-a",
    serviceAccountName: "web-sa",
    containers: [{ name: "app", image: "app:1.0" }],
  },
  status: { phase: "Running", containerStatuses: [{ name: "app", ready: true, state: { running: {} } }] },
};

describe("PodSummary", () => {
  it("renders the Node name as a clickable link to the Node's detail page", () => {
    renderSummary(basePod);
    fireEvent.click(screen.getByText("node-a"));
    expect(navigateMock).toHaveBeenCalledWith("/detail/nodes/_/node-a");
  });

  it("renders the Service Account as a clickable link, namespaced", () => {
    renderSummary(basePod);
    fireEvent.click(screen.getByText("web-sa"));
    expect(navigateMock).toHaveBeenCalledWith("/detail/serviceaccounts/prod/web-sa");
  });

  it("delegates each env var to PodEnvValue instead of showing a raw placeholder", () => {
    const obj = {
      ...basePod,
      spec: { ...basePod.spec, containers: [{ name: "app", image: "app:1.0", env: [{ name: "MODE", value: "prod" }] }] },
    };
    renderSummary(obj);
    expect(screen.getByTestId("env-MODE")).toBeTruthy();
  });

  it("renders a PVC volume with a clickable link to the PVC", () => {
    const obj = { ...basePod, spec: { ...basePod.spec, volumes: [{ name: "data", persistentVolumeClaim: { claimName: "data-pvc" } }] } };
    renderSummary(obj);
    fireEvent.click(screen.getByText(/data-pvc/));
    expect(navigateMock).toHaveBeenCalledWith("/detail/persistentvolumeclaims/prod/data-pvc");
  });

  it("renders a hostPath volume's path and type without a link", () => {
    const obj = { ...basePod, spec: { ...basePod.spec, volumes: [{ name: "docker", hostPath: { path: "/var/run/docker.sock", type: "Socket" } }] } };
    renderSummary(obj);
    expect(screen.getByText(/\/var\/run\/docker\.sock/)).toBeTruthy();
  });

  it("renders the previous terminated instance's reason, exit code, and run time", () => {
    const obj = {
      ...basePod,
      status: {
        ...basePod.status,
        containerStatuses: [
          {
            name: "app",
            ready: false,
            state: { waiting: { reason: "CrashLoopBackOff" } },
            lastState: { terminated: { reason: "OOMKilled", exitCode: 137, startedAt: "2026-09-01T00:00:00Z", finishedAt: "2026-09-01T00:02:13Z" } },
          },
        ],
      },
    };
    renderSummary(obj);
    expect(screen.getByText(/OOMKilled/)).toBeTruthy();
    expect(screen.getByText(/137/)).toBeTruthy();
    expect(screen.getByText(/2m 13s/)).toBeTruthy();
  });

  it("shows nothing extra for last state when the container has never crashed", () => {
    renderSummary(basePod);
    expect(screen.queryByText(/exit code/i)).toBeNull();
  });
});
