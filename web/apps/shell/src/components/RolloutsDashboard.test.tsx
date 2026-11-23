import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "../lib/api";
import { RolloutsDashboard } from "./RolloutsDashboard";

const navigateMock = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, applyYaml: vi.fn().mockResolvedValue({ applied: true, dryRun: false }) } };
});
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

beforeEach(() => {
  navigateMock.mockClear();
  vi.mocked(api.applyYaml).mockClear();
});

const GVR = "argoproj.io/v1alpha1/rollouts";
const rollout = {
  metadata: { name: "web", namespace: "shop" },
  spec: {
    replicas: 4,
    template: { spec: { containers: [{ image: "web:2" }] } },
    strategy: { canary: { steps: [{ setWeight: 20 }, { pause: {} }, { setWeight: 100 }] } },
  },
  status: {
    phase: "Paused",
    message: "CanaryPauseStep",
    currentStepIndex: 1,
    currentPodHash: "bbb",
    stableRS: "aaa",
    updatedReplicas: 1,
    readyReplicas: 4,
    availableReplicas: 4,
    pauseConditions: [{ reason: "CanaryPauseStep" }],
  },
};
const sets = [
  { metadata: { name: "web-aaa", labels: { "rollouts-pod-template-hash": "aaa" }, annotations: { "rollout.argoproj.io/revision": "1" }, ownerReferences: [{ kind: "Rollout", name: "web" }] }, spec: { template: { spec: { containers: [{ image: "web:1" }] } } } },
  { metadata: { name: "web-bbb", labels: { "rollouts-pod-template-hash": "bbb" }, annotations: { "rollout.argoproj.io/revision": "2" }, ownerReferences: [{ kind: "Rollout", name: "web" }] }, spec: { template: { spec: { containers: [{ image: "web:2" }] } } } },
];
const runs = [{ metadata: { name: "web-bbb-1", ownerReferences: [{ kind: "Rollout", name: "web" }] }, status: { phase: "Running" } }];

function ui(cluster = "kind-test") {
  return render(
    <MemoryRouter>
      <RolloutsDashboard cluster={cluster} rolloutGvr={GVR} rollouts={[rollout]} replicaSets={sets} analysisRuns={runs} />
    </MemoryRouter>,
  );
}

describe("RolloutsDashboard", () => {
  it("shows strategy, phase, step, weights, revisions and analysis runs", () => {
    ui();
    expect(screen.getByText("web")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.getByText("canary")).toBeTruthy();
    expect(screen.getByText(/step 2 of 3/i)).toBeTruthy();
    expect(screen.getByText(/20% canary/)).toBeTruthy();
    expect(screen.getByText(/80% stable/)).toBeTruthy();
    expect(screen.getByText(/web:1/)).toBeTruthy();
    expect(screen.getAllByText(/web:2/).length).toBeGreaterThan(0);
    expect(screen.getByText("CanaryPauseStep")).toBeTruthy();
    expect(screen.getByText("web-bbb-1")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("opens the Rollout drawer when the name is clicked", () => {
    ui();
    fireEvent.click(screen.getByText("web"));
    expect(navigateMock).toHaveBeenCalledWith("/detail/ext--argoproj.io--v1alpha1--rollouts/shop/web");
  });

  it("Promote sends the pause-clearing merge patch", async () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await waitFor(() => expect(api.applyYaml).toHaveBeenCalledTimes(2));
    const [status, spec] = vi.mocked(api.applyYaml).mock.calls.map((c) => c[0]);
    expect(status!.action).toBe("rollout-promote");
    expect(status!.mode).toBe("merge");
    expect(status!.subresource).toBe("status");
    expect(JSON.parse(status!.yaml).status.pauseConditions).toBeNull();
    expect(JSON.parse(spec!.yaml).spec.paused).toBe(false);
  });

  it("Pause sets spec.paused", async () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(api.applyYaml).toHaveBeenCalledTimes(1));
    const req = vi.mocked(api.applyYaml).mock.calls[0]![0];
    expect(req.action).toBe("rollout-pause");
    expect(JSON.parse(req.yaml).spec).toEqual({ paused: true });
  });

  it("Skip step moves status.currentStepIndex to the next step through the status subresource", async () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    await waitFor(() => expect(api.applyYaml).toHaveBeenCalledTimes(1));
    const req = vi.mocked(api.applyYaml).mock.calls[0]![0];
    expect(req.action).toBe("rollout-skip-step");
    expect(req.subresource).toBe("status");
    expect(JSON.parse(req.yaml).status).toEqual({ currentStepIndex: 2 });
  });

  it("offers Resume, not Pause, on a rollout the user paused", () => {
    render(
      <MemoryRouter>
        <RolloutsDashboard
          cluster="kind-test"
          rolloutGvr={GVR}
          rollouts={[{ ...rollout, spec: { ...rollout.spec, paused: true } }]}
          replicaSets={sets}
          analysisRuns={runs}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("asks before acting on a production-looking cluster", async () => {
    ui("prod-eu-1");
    fireEvent.click(screen.getByRole("button", { name: "Abort" }));
    expect(api.applyYaml).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Apply to/ }));
    await waitFor(() => expect(api.applyYaml).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.applyYaml).mock.calls[0]![0].action).toBe("rollout-abort");
  });

  it("shows an empty state with no Rollouts", () => {
    render(
      <MemoryRouter>
        <RolloutsDashboard cluster="kind-test" rolloutGvr={GVR} rollouts={[]} replicaSets={[]} analysisRuns={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No Rollouts found/)).toBeTruthy();
  });
});
