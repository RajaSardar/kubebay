import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RolloutLine } from "../RolloutLine";

// The rollout line on a Deployment drawer's Summary: how old the current
// revision is and how many rollouts happened in the last 7 days, from the
// ReplicaSets the cluster keeps, with a way into the Rollout tab.

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn(),
}));
const { useResourceStream } = await import("../../lib/useResourceStream");

const NOW = Date.parse("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const deploy = { kind: "Deployment", metadata: { uid: "dep-1", name: "api", namespace: "shop", creationTimestamp: ago(30 * DAY) } };

function rs(name: string, revision: number, created: string, history?: string) {
  const annotations: Record<string, string> = { "deployment.kubernetes.io/revision": String(revision) };
  if (history) annotations["deployment.kubernetes.io/revision-history"] = history;
  return { metadata: { name, creationTimestamp: created, annotations, ownerReferences: [{ kind: "Deployment", name: "api", uid: "dep-1" }] } };
}

function stream(rows: Record<string, unknown>[], synced = true) {
  vi.mocked(useResourceStream).mockReturnValue({ rows, synced, connected: true });
}

describe("RolloutLine", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.mocked(useResourceStream).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("says how old the current revision is and how many rollouts the week had", () => {
    stream([rs("api-1", 1, ago(30 * DAY)), rs("api-2", 2, ago(10 * DAY)), rs("api-3", 3, ago(5 * DAY)), rs("api-4", 4, ago(3 * DAY))]);
    render(<RolloutLine cluster="c1" obj={deploy} />);
    expect(screen.getByText("Revision 4, rolled out 3d ago · 2 rollouts in the last 7 days")).toBeInTheDocument();
    expect(useResourceStream).toHaveBeenCalledWith("c1", "apps/v1/replicasets", { mode: "full", ns: ["shop"] });
  });

  it("says when a Deployment has never been rolled out", () => {
    stream([rs("api-1", 1, ago(30 * DAY))]);
    render(<RolloutLine cluster="c1" obj={deploy} />);
    expect(screen.getByText("Revision 1, no rollouts since it was created 30d ago")).toBeInTheDocument();
  });

  it("names a rollback instead of giving it an age", () => {
    stream([rs("api-1", 1, ago(30 * DAY)), rs("api-2", 4, ago(10 * DAY), "2"), rs("api-3", 3, ago(2 * DAY))]);
    render(<RolloutLine cluster="c1" obj={deploy} />);
    expect(screen.getByText("Revision 4, a rollback to an earlier template · 2 rollouts in the last 7 days")).toBeInTheDocument();
  });

  it("says 'at least' when older ReplicaSets may have been pruned, and nothing about the week when it can't tell", () => {
    stream([rs("api-5", 5, ago(3 * DAY)), rs("api-6", 6, ago(2 * DAY)), rs("api-7", 7, ago(DAY))]);
    const a = render(<RolloutLine cluster="c1" obj={deploy} />);
    expect(screen.getByText("Revision 7, rolled out 24h ago · at least 3 rollouts in the last 7 days")).toBeInTheDocument();
    a.unmount();

    stream([rs("api-1", 3, ago(30 * DAY), "1"), rs("api-2", 2, ago(20 * DAY))]);
    render(<RolloutLine cluster="c1" obj={deploy} />);
    expect(screen.getByText("Revision 3, a rollback to an earlier template")).toBeInTheDocument();
  });

  it("says when the week had no rollouts", () => {
    stream([rs("api-1", 1, ago(30 * DAY)), rs("api-2", 2, ago(10 * DAY))]);
    render(<RolloutLine cluster="c1" obj={deploy} />);
    expect(screen.getByText("Revision 2, rolled out 10d ago · no rollouts in the last 7 days")).toBeInTheDocument();
  });

  it("opens the Rollout tab", () => {
    stream([rs("api-1", 1, ago(30 * DAY)), rs("api-2", 2, ago(DAY))]);
    const onShowRollout = vi.fn();
    render(<RolloutLine cluster="c1" obj={deploy} onShowRollout={onShowRollout} />);
    fireEvent.click(screen.getByRole("button", { name: "Rollout" }));
    expect(onShowRollout).toHaveBeenCalledTimes(1);
  });

  it("renders nothing until the ReplicaSets say something", () => {
    stream([], false);
    const a = render(<RolloutLine cluster="c1" obj={deploy} />);
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();

    stream([{ metadata: { name: "other", annotations: {}, ownerReferences: [] } }]);
    const b = render(<RolloutLine cluster="c1" obj={deploy} />);
    expect(b.container).toBeEmptyDOMElement();
  });

  it("reads a StatefulSet's ControllerRevisions, and dates its rollback", () => {
    const sts = { kind: "StatefulSet", metadata: { uid: "sts-1", name: "db", namespace: "shop", creationTimestamp: ago(30 * DAY) } };
    const cr = (name: string, revision: number, created: string, set = created) => ({
      kind: "ControllerRevision",
      revision,
      metadata: { name, creationTimestamp: created, ownerReferences: [{ uid: "sts-1" }], managedFields: [{ manager: "kube-controller-manager", time: set }] },
    });
    stream([cr("db-a", 4, ago(30 * DAY), ago(5 * 60 * 60_000)), cr("db-b", 2, ago(10 * DAY)), cr("db-c", 3, ago(2 * DAY))]);
    render(<RolloutLine cluster="c1" obj={sts} />);
    expect(screen.getByText("Revision 4, rolled back to an earlier template 5h ago · 2 rollouts in the last 7 days")).toBeInTheDocument();
    expect(useResourceStream).toHaveBeenCalledWith("c1", "apps/v1/controllerrevisions", { mode: "full", ns: ["shop"] });
  });
});
