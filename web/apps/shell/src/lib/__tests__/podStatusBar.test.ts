import { describe, expect, it } from "vitest";
import { podStatusSegments } from "../podStatusBar";

// Overview v2's pod status bar: one segment per status word, with its count,
// a tone that sits beside the word, and the Pods filter it opens.

type Obj = Record<string, unknown>;

function pod(name: string, o: { phase?: string; waiting?: string; ready?: boolean; deleting?: boolean } = {}): Obj {
  return {
    metadata: { name, namespace: "shop", ...(o.deleting ? { deletionTimestamp: "x" } : {}) },
    spec: { containers: [{ name: "c" }] },
    status: {
      phase: o.phase ?? "Running",
      containerStatuses: [{ name: "c", ready: o.ready ?? !o.waiting, restartCount: 0, state: o.waiting ? { waiting: { reason: o.waiting } } : { running: {} } }],
    },
  };
}

describe("podStatusSegments", () => {
  it("counts pods per status word, healthy first, failures by size", () => {
    const segs = podStatusSegments([
      pod("a"),
      pod("b"),
      pod("c"),
      pod("d", { waiting: "CrashLoopBackOff" }),
      pod("e", { waiting: "ImagePullBackOff" }),
      pod("f", { waiting: "ImagePullBackOff" }),
      pod("g", { phase: "Pending", ready: false }),
      pod("h", { phase: "Succeeded", ready: false }),
      pod("i", { deleting: true }),
    ]);
    expect(segs.map((s) => `${s.label}:${s.count}:${s.tone}`)).toEqual([
      "Running:3:ok",
      "Pending:1:pending",
      "Terminating:1:terminating",
      "Succeeded:1:terminated",
      "ImagePullBackOff:2:err",
      "CrashLoopBackOff:1:err",
    ]);
  });

  it("opens Pods filtered to the status word", () => {
    const [seg] = podStatusSegments([pod("d", { waiting: "CrashLoopBackOff" })]);
    expect(seg!.to).toBe("/workloads?q=status%3ACrashLoopBackOff");
  });

  it("is empty with no pods", () => {
    expect(podStatusSegments([])).toEqual([]);
  });
});
