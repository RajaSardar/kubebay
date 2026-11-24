import { describe, it, expect } from "vitest";
import { buildReleaseView } from "../rolloutRelease";

// Hand-written fixtures following the Rollout, ReplicaSet, AnalysisRun and
// Service shapes. Not captured from a live cluster.
const NS = "shop";
type O = Record<string, unknown>;

function canary(status: O = {}, spec: O = {}, steps: O[] = [{ setWeight: 20 }, { pause: {} }, { setWeight: 50 }, { pause: { duration: "1m" } }, { analysis: {} }]): O {
  return {
    metadata: { name: "web", namespace: NS, uid: "u1" },
    spec: { replicas: 4, strategy: { canary: { steps, stableService: "web-stable", canaryService: "web-canary" } }, ...spec },
    status: { currentStepIndex: 1, stableRS: "aaa", currentPodHash: "bbb", ...status },
  };
}
function rs(name: string, hash: string, rev: string, image: string, replicas: number, ready: number, uid = "u1"): O {
  return {
    metadata: { name, namespace: NS, labels: { "rollouts-pod-template-hash": hash }, annotations: { "rollout.argoproj.io/revision": rev }, ownerReferences: [{ kind: "Rollout", name: "web", uid }] },
    spec: { replicas, template: { spec: { containers: [{ image }] } } },
    status: { replicas, readyReplicas: ready },
  };
}
const SETS = [rs("web-aaa", "aaa", "1", "web:1", 3, 3), rs("web-bbb", "bbb", "2", "web:2", 1, 1)];

describe("steps", () => {
  it("marks done, current and pending around currentStepIndex", () => {
    const v = buildReleaseView(canary(), SETS, [], []);
    expect(v.steps.map((s) => s.state)).toEqual(["done", "current", "pending", "pending", "pending"]);
    expect(v.steps.map((s) => s.kind)).toEqual(["setWeight", "pause", "setWeight", "pause", "analysis"]);
    expect(v.steps[0]!.label).toBe("Set weight 20%");
    expect(v.steps[1]!.label).toBe("Pause");
    expect(v.steps[3]!.label).toBe("Pause 1m");
  });
  it("flags the current pause step as paused with its reason", () => {
    const v = buildReleaseView(canary({ phase: "Paused", pauseConditions: [{ reason: "CanaryPauseStep" }] }), SETS, [], []);
    expect(v.steps[1]!).toMatchObject({ paused: true, pauseReason: "CanaryPauseStep" });
    expect(v.steps[0]!.paused).toBe(false);
    expect(v.haltReason).toContain("CanaryPauseStep");
  });
  it("treats a missing index as step 0", () => {
    const v = buildReleaseView(canary({ currentStepIndex: undefined }), SETS, [], []);
    expect(v.steps[0]!.state).toBe("current");
  });
  it("marks every step done when the index equals the step count", () => {
    const v = buildReleaseView(canary({ currentStepIndex: 5 }), SETS, [], []);
    expect(v.steps.every((s) => s.state === "done")).toBe(true);
  });
  it("shows an abort on the current step only when the index is in range", () => {
    const a = buildReleaseView(canary({ abort: true, message: "RolloutAborted: metric failed" }), SETS, [], []);
    expect(a.steps[1]!).toMatchObject({ state: "current", note: "aborted" });
    const b = buildReleaseView(canary({ abort: true, currentStepIndex: 9 }), SETS, [], []);
    expect(b.steps.some((s) => s.state === "current")).toBe(false);
    expect(a.haltReason).toMatch(/^Aborted/);
    expect(a.phase).toBe("Aborted");
  });
  it("has no steps for blueGreen", () => {
    const ro = { metadata: { name: "web", namespace: NS, uid: "u1" }, spec: { strategy: { blueGreen: { activeService: "a" } } }, status: {} };
    const v = buildReleaseView(ro, [], [], []);
    expect(v.strategy).toBe("blueGreen");
    expect(v.steps).toEqual([]);
  });
  it("marks a user pause", () => {
    const v = buildReleaseView(canary({}, { paused: true }), SETS, [], []);
    expect(v.haltReason).toMatch(/paused/i);
  });
});

describe("replica sets", () => {
  it("assigns stable and canary roles with revision, images and pod counts", () => {
    const v = buildReleaseView(canary(), SETS, [], []);
    expect(v.replicaSets.map((r) => [r.name, r.role, r.revision, r.images, r.ready, r.desired])).toEqual([
      ["web-aaa", "stable", "1", ["web:1"], 3, 3],
      ["web-bbb", "canary", "2", ["web:2"], 1, 1],
    ]);
  });
  it("ignores ReplicaSets owned by another Rollout UID", () => {
    const v = buildReleaseView(canary(), [...SETS, rs("web-zzz", "zzz", "9", "x", 1, 1, "other")], [], []);
    expect(v.replicaSets).toHaveLength(2);
  });
  it("lists older revisions as previous, newest first", () => {
    const v = buildReleaseView(canary(), [...SETS, rs("web-old", "old", "0", "web:0", 0, 0), rs("web-older", "older", "-1", "web:x", 0, 0)], [], []);
    expect(v.replicaSets.filter((r) => r.role === "previous").map((r) => r.revision)).toEqual(["0", "-1"]);
  });
  it("uses the reported traffic weights as live", () => {
    const v = buildReleaseView(canary({ canary: { weights: { canary: { weight: 20 }, stable: { weight: 80 } } } }), SETS, [], []);
    expect(v.replicaSets[0]!).toMatchObject({ weight: 80, weightKind: "live" });
    expect(v.replicaSets[1]!).toMatchObject({ weight: 20, weightKind: "live" });
  });
  it("falls back to the step's setWeight as a target, never live", () => {
    const v = buildReleaseView(canary(), SETS, [], []);
    expect(v.replicaSets[1]!).toMatchObject({ weight: 20, weightKind: "target" });
    expect(v.replicaSets[0]!).toMatchObject({ weight: 80, weightKind: "target" });
  });
  it("shows no weights for blueGreen", () => {
    const ro = { metadata: { name: "web", namespace: NS, uid: "u1" }, spec: { strategy: { blueGreen: {} } }, status: { blueGreen: { activeSelector: "aaa", previewSelector: "bbb" } } };
    const v = buildReleaseView(ro, SETS, [], []);
    expect(v.replicaSets.map((r) => [r.role, r.weight])).toEqual([["active", null], ["preview", null]]);
  });
});

describe("analysis runs", () => {
  const run = (name: string, status: O, uid = "u1", created = "2026-01-01T00:00:00Z"): O => ({
    metadata: { name, namespace: NS, creationTimestamp: created, ownerReferences: [{ kind: "Rollout", name: "web", uid }] },
    status,
  });
  it("summarises metrics, last value and failure reasons", () => {
    const long = "x".repeat(500);
    const v = buildReleaseView(
      canary(),
      SETS,
      [
        run("web-bbb-1", {
          phase: "Failed",
          message: "metric \"success-rate\" assessed Failed",
          metricResults: [
            { name: "success-rate", phase: "Failed", count: 3, successful: 1, failed: 2, inconclusive: 0, error: 0, message: long, measurements: [{ value: "[0.99]" }, { value: "[0.80]", message: "m" }] },
            { name: "latency", phase: "Successful", successful: 3, measurements: [{ value: "12" }] },
          ],
        }),
      ],
      [],
    );
    const a = v.analyses[0]!;
    expect(a).toMatchObject({ name: "web-bbb-1", phase: "Failed", tone: "err" });
    expect(a.metrics[0]!).toMatchObject({ name: "success-rate", phase: "Failed", tone: "err", lastValue: "[0.80]" });
    expect(a.metrics[0]!.summary).toBe("1 successful, 2 failed");
    expect(a.metrics[0]!.failure?.length).toBeLessThanOrEqual(200);
    expect(a.metrics[1]!).toMatchObject({ tone: "ok", lastValue: "12" });
    expect(a.metrics[1]!.failure).toBeUndefined();
    expect(v.haltReason ?? "").toBe("");
  });
  it("names the failed analysis in the abort reason", () => {
    const v = buildReleaseView(canary({ abort: true }), SETS, [run("web-bbb-1", { phase: "Failed" })], []);
    expect(v.haltReason).toContain("web-bbb-1");
  });
  it("only shows runs owned by this Rollout, newest first", () => {
    const v = buildReleaseView(canary(), SETS, [run("old", { phase: "Successful" }, "u1", "2026-01-01T00:00:00Z"), run("new", { phase: "Running" }, "u1", "2026-02-01T00:00:00Z"), run("alien", { phase: "Failed" }, "u2")], []);
    expect(v.analyses.map((a) => a.name)).toEqual(["new", "old"]);
  });
  it("never surfaces args or secret references", () => {
    const v = buildReleaseView(canary(), SETS, [run("r", { phase: "Running", metricResults: [{ name: "m", phase: "Running", metadata: { token: "SECRET" }, measurements: [{ value: "1", metadata: { token: "SECRET" } }] }] })], []);
    expect(JSON.stringify(v)).not.toContain("SECRET");
  });
});

describe("conditions and message", () => {
  it("reports conditions with tones and a truncated message", () => {
    const v = buildReleaseView(
      canary({ message: "y".repeat(400), conditions: [{ type: "Available", status: "True", reason: "AvailableReason", message: "ok" }, { type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded", message: "timed out" }] }),
      SETS,
      [],
      [],
    );
    expect(v.message.length).toBeLessThanOrEqual(200);
    expect(v.conditions.map((c) => [c.type, c.tone])).toEqual([["Available", "ok"], ["Progressing", "err"]]);
  });
});

describe("services", () => {
  const svc = (name: string, hash?: string): O => ({ metadata: { name, namespace: NS }, spec: { selector: hash ? { app: "web", "rollouts-pod-template-hash": hash } : { app: "web" } } });
  const bg = (): O => ({
    metadata: { name: "web", namespace: NS, uid: "u1" },
    spec: { strategy: { blueGreen: { activeService: "web-active", previewService: "web-preview" } } },
    status: { blueGreen: { activeSelector: "aaa", previewSelector: "bbb" } },
  });
  it("finds blueGreen services and the revision each selects", () => {
    const v = buildReleaseView(bg(), SETS, [], [svc("web-active", "aaa"), svc("web-preview", "bbb")]);
    expect(v.services).toEqual([
      { role: "active", name: "web-active", found: true, selectsRevision: "1" },
      { role: "preview", name: "web-preview", found: true, selectsRevision: "2" },
    ]);
    expect(v.servicesAvailable).toBe(true);
  });
  it("marks a missing Service", () => {
    const v = buildReleaseView(bg(), SETS, [], [svc("web-active", "aaa")]);
    expect(v.services[1]!).toMatchObject({ role: "preview", name: "web-preview", found: false });
  });
  it("shows names only, found unknown, when Services are not readable", () => {
    const v = buildReleaseView(bg(), SETS, [], null);
    expect(v.servicesAvailable).toBe(false);
    expect(v.services.map((s) => s.found)).toEqual([null, null]);
  });
  it("lists canary stable and canary Services without a revision", () => {
    const v = buildReleaseView(canary(), SETS, [], [svc("web-stable", "aaa"), svc("web-canary")]);
    expect(v.services.map((s) => [s.role, s.name, s.found, s.selectsRevision])).toEqual([["stable", "web-stable", true, undefined], ["canary", "web-canary", true, undefined]]);
  });
  it("ignores Services in other namespaces", () => {
    const other = { metadata: { name: "web-active", namespace: "other" }, spec: {} };
    const v = buildReleaseView(bg(), SETS, [], [other]);
    expect(v.services[0]!.found).toBe(false);
  });
});

describe("actions", () => {
  it("offers the same actions the dashboard does", () => {
    expect(buildReleaseView(canary({ abort: true }), SETS, [], []).actions).toEqual(["retry", "restart"]);
  });
});
