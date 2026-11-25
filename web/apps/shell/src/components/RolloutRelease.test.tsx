import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RolloutRelease } from "./RolloutRelease";
import { buildReleaseView } from "../lib/rolloutRelease";

type O = Record<string, unknown>;
const ro: O = {
  metadata: { name: "web", namespace: "shop", uid: "u1" },
  spec: { replicas: 4, strategy: { canary: { steps: [{ setWeight: 20 }, { pause: {} }, { setWeight: 100 }], stableService: "web-stable" } } },
  status: { phase: "Paused", message: "CanaryPauseStep", currentStepIndex: 1, stableRS: "aaa", currentPodHash: "bbb", pauseConditions: [{ reason: "CanaryPauseStep" }] },
};
const rs = (name: string, hash: string, rev: string, image: string) => ({
  metadata: { name, namespace: "shop", labels: { "rollouts-pod-template-hash": hash }, annotations: { "rollout.argoproj.io/revision": rev }, ownerReferences: [{ kind: "Rollout", name: "web", uid: "u1" }] },
  spec: { replicas: 2, template: { spec: { containers: [{ image }] } } },
  status: { readyReplicas: 2 },
});
const runs = [
  {
    metadata: { name: "web-bbb-1", namespace: "shop", ownerReferences: [{ kind: "Rollout", name: "web", uid: "u1" }] },
    status: { phase: "Failed", metricResults: [{ name: "success-rate", phase: "Failed", failed: 1, message: "<b>bad</b> value", measurements: [{ value: "0.5" }] }] },
  },
];

describe("RolloutRelease", () => {
  it("shows steps, replica sets, weights, analysis and the halt reason", () => {
    const view = buildReleaseView(ro, [rs("web-aaa", "aaa", "1", "web:1"), rs("web-bbb", "bbb", "2", "web:2")], runs, null);
    render(<RolloutRelease view={view} />);
    expect(screen.getByText("Set weight 20%")).toBeTruthy();
    expect(screen.getByText(/Paused: CanaryPauseStep/)).toBeTruthy();
    expect(screen.getByText("web-aaa")).toBeTruthy();
    expect(screen.getByText("web:2")).toBeTruthy();
    expect(screen.getAllByText(/target/).length).toBeGreaterThan(0);
    expect(screen.getByText("success-rate")).toBeTruthy();
    expect(screen.getByText(/0\.5/)).toBeTruthy();
  });
  it("renders hostile status text as text, not markup", () => {
    const view = buildReleaseView(ro, [], runs, null);
    const { container } = render(<RolloutRelease view={view} />);
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/<b>bad<\/b> value/)).toBeTruthy();
  });
  it("says Services are not available to the user, distinct from none", () => {
    const view = buildReleaseView(ro, [], [], null);
    render(<RolloutRelease view={view} />);
    expect(screen.getByText(/not available to you/i)).toBeTruthy();
  });
  it("notes a Service that does not exist", () => {
    const view = buildReleaseView(ro, [], [], []);
    render(<RolloutRelease view={view} />);
    expect(screen.getByText(/web-stable/)).toBeTruthy();
    expect(screen.getByText(/not found/i)).toBeTruthy();
  });
});
