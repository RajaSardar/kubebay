import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineTab } from "../TimelineTab";
import { useResourceStream } from "../../lib/useResourceStream";

const deploy = {
  kind: "Deployment",
  metadata: { name: "web", namespace: "shop", uid: "d-1" },
  status: { conditions: [{ type: "Available", status: "False", reason: "MinimumReplicasUnavailable", lastTransitionTime: "2026-09-30T10:05:00Z" }] },
};
const rs = {
  metadata: {
    name: "web-2", namespace: "shop", uid: "rs-2", creationTimestamp: "2026-09-30T10:00:00Z",
    annotations: { "deployment.kubernetes.io/revision": "2" },
    ownerReferences: [{ kind: "Deployment", name: "web", uid: "d-1", controller: true }],
  },
  spec: { template: { spec: { containers: [{ name: "app", image: "shop/web:2" }] } } },
};
const event = {
  metadata: { name: "e1", namespace: "shop" },
  involvedObject: { kind: "Deployment", name: "web", namespace: "shop" },
  reason: "ScalingReplicaSet", message: "Scaled up replica set web-2 to 3", type: "Normal", lastTimestamp: "2026-09-30T10:00:01Z",
};

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string, gvr: string) => ({
    rows: gvr === "v1/events" ? [event] : gvr === "apps/v1/replicasets" ? [rs] : [],
    synced: true,
  })),
}));

describe("TimelineTab", () => {
  it("lists events, revisions and condition changes for the workload in one view", () => {
    render(<TimelineTab cluster="c1" ns="shop" obj={deploy} />);
    expect(screen.getByText("ScalingReplicaSet")).toBeInTheDocument();
    expect(screen.getByText("Revision 2")).toBeInTheDocument();
    expect(screen.getByText("app=shop/web:2")).toBeInTheDocument();
    expect(screen.getByText("Available → False")).toBeInTheDocument();
    expect(screen.getByText(/Events are kept for about an hour/)).toBeInTheDocument();
  });

  it("streams ReplicaSets and pods only in the workload's namespace", () => {
    render(<TimelineTab cluster="c1" ns="shop" obj={deploy} />);
    const calls = vi.mocked(useResourceStream).mock.calls;
    const rsCall = calls.find((c) => c[1] === "apps/v1/replicasets")!;
    expect(rsCall[2]).toMatchObject({ mode: "full", ns: ["shop"], enabled: true });
    const podCall = calls.find((c) => c[1] === "v1/pods")!;
    expect(podCall[2]).toMatchObject({ mode: "full", ns: ["shop"] });
  });

  it("says when nothing has been recorded", () => {
    render(<TimelineTab cluster="c1" ns="shop" obj={{ kind: "DaemonSet", metadata: { name: "x", namespace: "shop", uid: "u" } }} />);
    expect(screen.getByText(/Nothing recorded for this daemonset/)).toBeInTheDocument();
  });
});
