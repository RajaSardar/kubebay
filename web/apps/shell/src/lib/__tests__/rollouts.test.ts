import { describe, it, expect } from "vitest";
import {
  detectRollouts,
  describeRollout,
  rolloutPhase,
  rolloutTone,
  canaryWeights,
  rolloutActionRequests,
  availableRolloutActions,
} from "../rollouts";

const NS = "shop";
function rollout(over: Record<string, unknown> = {}, status: Record<string, unknown> = {}, spec: Record<string, unknown> = {}) {
  return {
    metadata: { name: "web", namespace: NS, uid: "u1" },
    spec: {
      replicas: 4,
      template: { spec: { containers: [{ name: "app", image: "web:2" }] } },
      strategy: {
        canary: { steps: [{ setWeight: 20 }, { pause: {} }, { setWeight: 50 }, { pause: { duration: "1m" } }, { setWeight: 100 }] },
      },
      ...spec,
    },
    status: { replicas: 4, updatedReplicas: 1, readyReplicas: 4, availableReplicas: 4, ...status },
    ...over,
  };
}
function rs(name: string, hash: string, rev: string, image: string, replicas = 1, owner = "web") {
  return {
    metadata: {
      name,
      namespace: NS,
      labels: { "rollouts-pod-template-hash": hash },
      annotations: { "rollout.argoproj.io/revision": rev },
      ownerReferences: [{ kind: "Rollout", name: owner }],
    },
    spec: { replicas, template: { spec: { containers: [{ image }] } } },
    status: { readyReplicas: replicas },
  };
}
function ar(name: string, phase: string, owner = "web") {
  return { metadata: { name, namespace: NS, ownerReferences: [{ kind: "Rollout", name: owner }] }, status: { phase } };
}

describe("detectRollouts", () => {
  it("finds the Rollout and AnalysisRun CRDs", () => {
    const d = detectRollouts([
      { group: "argoproj.io", resource: "rollouts", gvr: "argoproj.io/v1alpha1/rollouts" },
      { group: "argoproj.io", resource: "analysisruns", gvr: "argoproj.io/v1alpha1/analysisruns" },
    ] as never);
    expect(d).toEqual({ installed: true, rolloutGvr: "argoproj.io/v1alpha1/rollouts", analysisRunGvr: "argoproj.io/v1alpha1/analysisruns" });
  });
  it("is not installed without the Rollout CRD (Application alone does not count)", () => {
    expect(detectRollouts([{ group: "argoproj.io", resource: "applications", gvr: "argoproj.io/v1alpha1/applications" }] as never).installed).toBe(false);
  });
});

describe("rolloutPhase", () => {
  it.each([
    ["status.phase wins", { phase: "Healthy" }, {}, "Healthy"],
    ["abort shows Aborted", { abort: true }, {}, "Aborted"],
    ["paused via pauseConditions", { pauseConditions: [{ reason: "CanaryPauseStep" }] }, {}, "Paused"],
    ["paused via spec", {}, { paused: true }, "Paused"],
    ["nothing known is Progressing", {}, {}, "Progressing"],
  ])("%s", (_n, status, spec, want) => {
    expect(rolloutPhase(rollout({}, status, spec))).toBe(want);
  });
  it("abort beats a Degraded phase", () => {
    expect(rolloutPhase(rollout({}, { phase: "Degraded", abort: true }))).toBe("Aborted");
  });
});

describe("rolloutTone", () => {
  it.each([
    ["Healthy", "ok"],
    ["Progressing", "pending"],
    ["Paused", "warn"],
    ["Degraded", "err"],
    ["Aborted", "err"],
    ["Successful", "ok"],
    ["Running", "ok"],
    ["Inconclusive", "warn"],
  ])("%s -> %s", (w, t) => expect(rolloutTone(w)).toBe(t));
});

describe("canaryWeights", () => {
  it.each([
    ["from status.canary.weights", { canary: { weights: { canary: { weight: 30 }, stable: { weight: 70 } } }, currentStepIndex: 0 }, 30, 70],
    ["from the last setWeight before the current step", { currentStepIndex: 3 }, 50, 50],
    ["step 0 is before any step completed", { currentStepIndex: 0 }, 0, 100],
    ["past the last step is 100", { currentStepIndex: 5 }, 100, 0],
  ])("%s", (_n, status, canary, stable) => {
    expect(canaryWeights(rollout({}, status))).toEqual({ canary, stable });
  });
  it("blue-green has no weights", () => {
    expect(canaryWeights(rollout({}, {}, { strategy: { blueGreen: {} } }))).toBeNull();
  });
});

describe("describeRollout", () => {
  it("summarises a paused canary", () => {
    const r = rollout(
      {},
      { phase: "Paused", message: "CanaryPauseStep", currentStepIndex: 1, currentPodHash: "bbb", stableRS: "aaa", pauseConditions: [{ reason: "CanaryPauseStep" }] },
    );
    const d = describeRollout(
      r,
      [rs("web-aaa", "aaa", "1", "web:1", 3), rs("web-bbb", "bbb", "2", "web:2", 1), rs("other-x", "x", "9", "o:1", 1, "other")],
      [ar("web-bbb-1", "Running"), ar("other-1", "Failed", "other")],
    );
    expect(d.strategy).toBe("canary");
    expect(d.phase).toBe("Paused");
    expect(d.tone).toBe("warn");
    expect(d.step).toEqual({ current: 2, total: 5 });
    expect(d.paused).toBe(true);
    expect(d.pauseMessage).toBe("CanaryPauseStep");
    expect(d.weights).toEqual({ canary: 20, stable: 80 });
    expect(d.replicas).toEqual({ desired: 4, updated: 1, ready: 4, available: 4 });
    expect(d.stable).toEqual({ name: "web-aaa", revision: "1", images: ["web:1"] });
    expect(d.canary).toEqual({ name: "web-bbb", revision: "2", images: ["web:2"] });
    expect(d.analysisRuns).toEqual([{ name: "web-bbb-1", phase: "Running", tone: "ok" }]);
  });
  it("blue-green has no step and uses the stable and current hashes", () => {
    const r = rollout({}, { phase: "Healthy", currentPodHash: "bbb", stableRS: "aaa" }, { strategy: { blueGreen: {} } });
    const d = describeRollout(r, [rs("web-aaa", "aaa", "1", "web:1"), rs("web-bbb", "bbb", "2", "web:2")], []);
    expect(d.strategy).toBe("blueGreen");
    expect(d.step).toBeNull();
    expect(d.weights).toBeNull();
    expect(d.stable?.name).toBe("web-aaa");
    expect(d.canary?.name).toBe("web-bbb");
  });
  it("has no canary when stable and current are the same", () => {
    const d = describeRollout(rollout({}, { phase: "Healthy", currentPodHash: "aaa", stableRS: "aaa" }), [rs("web-aaa", "aaa", "1", "web:1")], []);
    expect(d.canary).toBeNull();
  });
});

describe("availableRolloutActions", () => {
  it("offers Promote, Promote fully, Skip step, Pause and Abort while paused at a step", () => {
    expect(availableRolloutActions(rollout({}, { phase: "Paused", pauseConditions: [{}], currentStepIndex: 1 }))).toEqual([
      "promote",
      "promote-full",
      "skip-step",
      "pause",
      "abort",
      "restart",
    ]);
  });
  it("offers Resume instead of Pause when the user paused it (spec.paused)", () => {
    const ro = rollout({}, { phase: "Paused", currentStepIndex: 2 }, { paused: true });
    expect(availableRolloutActions(ro)).toContain("resume");
    expect(availableRolloutActions(ro)).not.toContain("pause");
  });
  it("offers Retry, not Abort, when aborted", () => {
    expect(availableRolloutActions(rollout({}, { abort: true, phase: "Degraded" }))).toEqual(["retry", "restart"]);
  });
  it("offers Promote, Skip step, Pause and Abort while progressing", () => {
    expect(availableRolloutActions(rollout({}, { phase: "Progressing" }))).toEqual(["promote", "promote-full", "skip-step", "pause", "abort", "restart"]);
  });
  it("no Skip step past the last step, or for blue-green", () => {
    expect(availableRolloutActions(rollout({}, { phase: "Progressing", currentStepIndex: 5 }))).not.toContain("skip-step");
    const bg = rollout({}, { phase: "Paused" }, { strategy: { blueGreen: { activeService: "web" } } });
    expect(availableRolloutActions(bg)).not.toContain("skip-step");
    expect(availableRolloutActions(bg)).toContain("pause");
  });
  it("only Restart when healthy", () => {
    expect(availableRolloutActions(rollout({}, { phase: "Healthy" }))).toEqual(["restart"]);
  });
});

describe("rolloutActionRequests", () => {
  const t = { cluster: "kind-x", gvr: "argoproj.io/v1alpha1/rollouts", ns: NS, name: "web" };
  const parse = (y: string) => JSON.parse(y);
  const only = (action: Parameters<typeof rolloutActionRequests>[1], ro: Record<string, unknown> = rollout()) => {
    const rs = rolloutActionRequests(t, action, ro);
    expect(rs).toHaveLength(1);
    return rs[0]!;
  };
  it("promote clears status.pauseConditions on the status subresource, then spec.paused on the resource", () => {
    const [status, spec] = rolloutActionRequests(t, "promote", rollout());
    expect(status!.subresource).toBe("status");
    expect(parse(status!.yaml)).toMatchObject({ status: { pauseConditions: null } });
    expect(parse(status!.yaml).spec).toBeUndefined();
    expect(spec!.subresource).toBeUndefined();
    expect(parse(spec!.yaml)).toMatchObject({ spec: { paused: false } });
    expect(parse(spec!.yaml).status).toBeUndefined();
    for (const r of [status!, spec!]) {
      expect(r.mode).toBe("merge");
      expect(r.action).toBe("rollout-promote");
      expect(r.dryRun).toBe(false);
    }
  });
  it("promote-full sets status.promoteFull on the status subresource", () => {
    const [status] = rolloutActionRequests(t, "promote-full", rollout());
    expect(status!.subresource).toBe("status");
    expect(parse(status!.yaml).status).toMatchObject({ promoteFull: true, pauseConditions: null });
  });
  it("abort sets status.abort on the status subresource", () => {
    const r = only("abort");
    expect(r.subresource).toBe("status");
    expect(parse(r.yaml).status).toEqual({ abort: true });
  });
  it("retry clears status.abort on the status subresource", () => {
    const r = only("retry");
    expect(r.subresource).toBe("status");
    expect(parse(r.yaml).status).toEqual({ abort: false });
  });
  it("pause sets spec.paused, like kubectl argo rollouts pause", () => {
    const r = only("pause");
    expect(r.subresource).toBeUndefined();
    expect(parse(r.yaml).spec).toEqual({ paused: true });
    expect(parse(r.yaml).status).toBeUndefined();
    expect(r.action).toBe("rollout-pause");
  });
  it("resume only clears spec.paused, leaving any step pause in place", () => {
    const r = only("resume", rollout({}, {}, { paused: true }));
    expect(parse(r.yaml).spec).toEqual({ paused: false });
    expect(parse(r.yaml).status).toBeUndefined();
  });
  it("skip step sets status.currentStepIndex to the next step on the status subresource", () => {
    const r = only("skip-step", rollout({ metadata: { name: "web", namespace: NS, resourceVersion: "42" } }, { currentStepIndex: 1 }));
    expect(r.subresource).toBe("status");
    expect(r.action).toBe("rollout-skip-step");
    const y = parse(r.yaml);
    expect(y.status).toEqual({ currentStepIndex: 2 });
    // The index was read from this version: refuse (409) rather than move it backwards if the controller got there first.
    expect(y.metadata.resourceVersion).toBe("42");
  });
  it("skip step from an unset index moves to the second step", () => {
    expect(parse(only("skip-step", rollout()).yaml).status).toEqual({ currentStepIndex: 1 });
  });
  it("skip step never passes the step count", () => {
    expect(parse(only("skip-step", rollout({}, { currentStepIndex: 5 })).yaml).status).toEqual({ currentStepIndex: 5 });
  });
  it("restart sets spec.restartAt to the given time", () => {
    const y = parse(rolloutActionRequests(t, "restart", rollout(), new Date("2026-01-02T03:04:05Z"))[0]!.yaml);
    expect(y.spec).toEqual({ restartAt: "2026-01-02T03:04:05.000Z" });
  });
  it("names the object", () => {
    const y = parse(only("abort").yaml);
    expect(y).toMatchObject({ apiVersion: "argoproj.io/v1alpha1", kind: "Rollout", metadata: { name: "web", namespace: NS } });
  });
});
