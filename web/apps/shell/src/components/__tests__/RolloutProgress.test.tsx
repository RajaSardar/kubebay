import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RolloutProgress } from "../RolloutProgress";

const mockUseResourceStream = vi.fn();
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: (...args: unknown[]) => mockUseResourceStream(...args),
}));

const deployment = {
  metadata: { uid: "dep-1", name: "my-app", namespace: "default" },
  spec: { replicas: 3 },
  status: { conditions: [] },
};

const newRs = {
  metadata: {
    name: "my-app-new",
    annotations: { "deployment.kubernetes.io/revision": "2" },
    ownerReferences: [{ kind: "Deployment", uid: "dep-1" }],
  },
  spec: { replicas: 3 },
  status: { readyReplicas: 3 },
};

describe("RolloutProgress", () => {
  it("shows a loading state before the ReplicaSet stream syncs", () => {
    mockUseResourceStream.mockReturnValue({ rows: [], synced: false, connected: true });
    render(<RolloutProgress cluster="kind-test" namespace="default" obj={deployment} />);
    expect(screen.getByRole("status", { name: /loading rollout status/i })).toBeTruthy();
  });

  it("shows the ready count and a segment per owned ReplicaSet", () => {
    mockUseResourceStream.mockReturnValue({ rows: [newRs], synced: true, connected: true });
    const { container } = render(<RolloutProgress cluster="kind-test" namespace="default" obj={deployment} />);
    expect(screen.getByText(/Rollout progress \(3\/3 ready\)/)).toBeTruthy();
    expect(container.querySelectorAll(".rollout-bar-segment.new")).toHaveLength(1);
    expect(screen.getByText("my-app-new")).toBeTruthy();
  });

  it("shows a stuck banner naming ProgressDeadlineExceeded", () => {
    mockUseResourceStream.mockReturnValue({ rows: [newRs], synced: true, connected: true });
    const stuckDeployment = {
      ...deployment,
      status: {
        conditions: [{ type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded", message: "timed out waiting" }],
      },
    };
    render(<RolloutProgress cluster="kind-test" namespace="default" obj={stuckDeployment} />);
    expect(screen.getByText(/ProgressDeadlineExceeded/)).toBeTruthy();
    expect(screen.getByText(/timed out waiting/)).toBeTruthy();
  });

  it("shows an empty state when the Deployment has no owned ReplicaSets yet", () => {
    mockUseResourceStream.mockReturnValue({ rows: [], synced: true, connected: true });
    render(<RolloutProgress cluster="kind-test" namespace="default" obj={deployment} />);
    expect(screen.getByText(/no replicasets found/i)).toBeTruthy();
  });

  it("shows a fallback message when the object failed to load", () => {
    mockUseResourceStream.mockReturnValue({ rows: [], synced: true, connected: true });
    render(<RolloutProgress cluster="kind-test" namespace="default" obj={null} />);
    expect(screen.getByText(/could not load object data/i)).toBeTruthy();
  });
});
