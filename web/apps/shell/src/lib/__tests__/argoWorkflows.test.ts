import { describe, it, expect } from "vitest";
import {
  detectArgoWorkflows,
  summarizeWorkflow,
  buildNodeTree,
  matchNodePods,
  workflowActions,
  workflowActionRequest,
  resubmitManifest,
  retryCommand,
  summarizeCronWorkflow,
  summarizeTemplate,
  formatDuration,
} from "../argoWorkflows";
import type { CRDEntry } from "../api";

function crd(resource: string, kind: string, over: Partial<CRDEntry> = {}): CRDEntry {
  return {
    name: `${resource}.argoproj.io`,
    group: "argoproj.io",
    version: "v1alpha1",
    resource,
    kind,
    namespaced: true,
    gvr: `argoproj.io/v1alpha1/${resource}`,
    columns: [],
    ...over,
  };
}

const NOW = new Date("2026-11-19T12:00:00Z");

describe("detectArgoWorkflows", () => {
  it("is not installed with only ArgoCD / Rollouts CRDs (same group)", () => {
    const d = detectArgoWorkflows([crd("applications", "Application"), crd("rollouts", "Rollout")]);
    expect(d.installed).toBe(false);
  });
  it("finds each Workflows kind by resource name", () => {
    const d = detectArgoWorkflows([
      crd("workflows", "Workflow"),
      crd("workflowtemplates", "WorkflowTemplate"),
      crd("clusterworkflowtemplates", "ClusterWorkflowTemplate", { namespaced: false }),
      crd("cronworkflows", "CronWorkflow"),
    ]);
    expect(d).toEqual({
      installed: true,
      workflowGvr: "argoproj.io/v1alpha1/workflows",
      templateGvr: "argoproj.io/v1alpha1/workflowtemplates",
      clusterTemplateGvr: "argoproj.io/v1alpha1/clusterworkflowtemplates",
      cronGvr: "argoproj.io/v1alpha1/cronworkflows",
    });
  });
  it("counts a templates-only install as installed", () => {
    expect(detectArgoWorkflows([crd("workflowtemplates", "WorkflowTemplate")]).installed).toBe(true);
  });
  it("ignores a same-named resource from another group", () => {
    expect(detectArgoWorkflows([crd("workflows", "Workflow", { group: "example.com" })]).installed).toBe(false);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [45_000, "45s"],
    [125_000, "2m 5s"],
    [3_600_000, "1h 0m"],
    [3_725_000, "1h 2m"],
    [90_000_000, "1d 1h"],
  ])("%i ms -> %s", (ms, out) => expect(formatDuration(ms)).toBe(out));
});

describe("summarizeWorkflow", () => {
  const base = (status: Record<string, unknown>, spec: Record<string, unknown> = {}) => ({
    metadata: { name: "wf-1", namespace: "ci" },
    spec,
    status,
  });

  it.each(["Running", "Succeeded", "Failed", "Error", "Pending"])("keeps phase %s", (phase) => {
    expect(summarizeWorkflow(base({ phase }), NOW).phase).toBe(phase);
  });
  it("is Pending before the controller has set a phase", () => {
    expect(summarizeWorkflow({ metadata: { name: "a", namespace: "n" } }, NOW).phase).toBe("Pending");
  });
  it("parses status.progress as done/total", () => {
    const s = summarizeWorkflow(base({ phase: "Running", progress: "2/5" }), NOW);
    expect(s.progress).toEqual({ done: 2, total: 5 });
    expect(s.progressText).toBe("2/5");
  });
  it("falls back to counting Pod nodes when progress is missing", () => {
    const s = summarizeWorkflow(
      base({
        phase: "Running",
        nodes: {
          a: { type: "Pod", phase: "Succeeded" },
          b: { type: "Pod", phase: "Running" },
          c: { type: "DAG", phase: "Running" },
        },
      }),
      NOW,
    );
    expect(s.progress).toEqual({ done: 1, total: 2 });
  });
  it("has no progress when there is nothing to count", () => {
    const s = summarizeWorkflow(base({ phase: "Pending" }), NOW);
    expect(s.progress).toBeNull();
    expect(s.progressText).toBe("–");
  });
  it("ignores a malformed progress string", () => {
    expect(summarizeWorkflow(base({ phase: "Running", progress: "x/y" }), NOW).progress).toBeNull();
  });
  it("duration is finished minus started", () => {
    const s = summarizeWorkflow(
      base({ phase: "Succeeded", startedAt: "2026-11-19T11:00:00Z", finishedAt: "2026-11-19T11:02:05Z" }),
      NOW,
    );
    expect(s.durationMs).toBe(125_000);
    expect(s.durationText).toBe("2m 5s");
  });
  it("duration of a running workflow runs to now", () => {
    const s = summarizeWorkflow(base({ phase: "Running", startedAt: "2026-11-19T11:59:00Z" }), NOW);
    expect(s.durationMs).toBe(60_000);
  });
  it("duration is a dash without a start time", () => {
    const s = summarizeWorkflow(base({ phase: "Pending" }), NOW);
    expect(s.durationMs).toBeNull();
    expect(s.durationText).toBe("–");
  });
  it("carries the message and suspended flag", () => {
    const s = summarizeWorkflow(base({ phase: "Failed", message: "boom" }, { suspend: true }), NOW);
    expect(s.message).toBe("boom");
    expect(s.suspended).toBe(true);
  });
});

describe("buildNodeTree", () => {
  const wf = {
    metadata: { name: "wf", namespace: "ci" },
    status: {
      nodes: {
        wf: { id: "wf", name: "wf", displayName: "wf", type: "DAG", phase: "Running", children: ["a", "b"] },
        a: { id: "a", name: "wf.a", displayName: "a", type: "Pod", phase: "Succeeded", templateName: "step", children: ["c"] },
        b: { id: "b", name: "wf.b", displayName: "b", type: "Pod", phase: "Failed", message: "exit 1", children: ["c"] },
        c: { id: "c", name: "wf.c", displayName: "c", type: "Pod", phase: "Pending" },
      },
    },
  };
  it("walks from the root depth-first with depth", () => {
    const t = buildNodeTree(wf);
    expect(t.map((n) => [n.displayName, n.depth])).toEqual([
      ["wf", 0],
      ["a", 1],
      ["c", 2],
      ["b", 1],
    ]);
  });
  it("shows a node with two parents once", () => {
    expect(buildNodeTree(wf).filter((n) => n.id === "c")).toHaveLength(1);
  });
  it("carries phase, type, message and template", () => {
    const t = buildNodeTree(wf);
    expect(t.find((n) => n.id === "b")).toMatchObject({ phase: "Failed", type: "Pod", message: "exit 1" });
    expect(t.find((n) => n.id === "a")?.templateName).toBe("step");
  });
  it("survives a cycle", () => {
    const cyc = {
      metadata: { name: "x" },
      status: { nodes: { x: { id: "x", type: "DAG", phase: "Running", children: ["y"] }, y: { id: "y", type: "Pod", phase: "Running", children: ["x"] } } },
    };
    expect(buildNodeTree(cyc).map((n) => n.id)).toEqual(["x", "y"]);
  });
  it("appends nodes unreachable from the root", () => {
    const orphan = {
      metadata: { name: "r" },
      status: { nodes: { r: { id: "r", type: "DAG", phase: "Running" }, o: { id: "o", type: "Pod", phase: "Running" } } },
    };
    expect(buildNodeTree(orphan).map((n) => [n.id, n.depth])).toEqual([["r", 0], ["o", 0]]);
  });
  it("is empty without status.nodes", () => {
    expect(buildNodeTree({ metadata: { name: "q" } })).toEqual([]);
  });
});

describe("matchNodePods", () => {
  const nodes = [
    { id: "wf-123", name: "wf.a", displayName: "a", type: "Pod", phase: "Succeeded", message: "", depth: 1, templateName: "" },
    { id: "wf-456", name: "wf.b", displayName: "b", type: "Pod", phase: "Running", message: "", depth: 1, templateName: "" },
    { id: "wf", name: "wf", displayName: "wf", type: "DAG", phase: "Running", message: "", depth: 0, templateName: "" },
  ];
  const pod = (name: string, ann: Record<string, string>, wf = "wf") => ({
    metadata: { name, namespace: "ci", labels: { "workflows.argoproj.io/workflow": wf }, annotations: ann },
  });
  it("matches by the node-name annotation", () => {
    const m = matchNodePods("wf", nodes, [pod("wf-a-999", { "workflows.argoproj.io/node-name": "wf.a" })]);
    expect(m.get("wf-123")).toBe("wf-a-999");
    expect(m.has("wf-456")).toBe(false);
  });
  it("matches by node-id annotation", () => {
    const m = matchNodePods("wf", nodes, [pod("p2", { "workflows.argoproj.io/node-id": "wf-456" })]);
    expect(m.get("wf-456")).toBe("p2");
  });
  it("falls back to a pod named like the node id", () => {
    const m = matchNodePods("wf", nodes, [pod("wf-123", {})]);
    expect(m.get("wf-123")).toBe("wf-123");
  });
  it("ignores pods of other workflows and non-Pod nodes", () => {
    const m = matchNodePods("wf", nodes, [pod("z", { "workflows.argoproj.io/node-name": "wf.a" }, "other"), pod("wf", {})]);
    expect(m.size).toBe(0);
  });
});

describe("workflowActions", () => {
  const wf = (phase: string, spec: Record<string, unknown> = {}) => ({ metadata: { name: "w" }, spec, status: { phase } });
  it("a running workflow can be stopped, terminated or suspended, and resubmitted", () => {
    expect(workflowActions(wf("Running")).map((a) => a.id)).toEqual(["stop", "terminate", "suspend", "resubmit"]);
  });
  it("a suspended running workflow can be resumed instead", () => {
    expect(workflowActions(wf("Running", { suspend: true })).map((a) => a.id)).toEqual(["stop", "terminate", "resume", "resubmit"]);
  });
  it.each(["Succeeded", "Failed", "Error"])("a %s workflow can only be resubmitted", (p) => {
    expect(workflowActions(wf(p)).map((a) => a.id)).toEqual(["resubmit"]);
  });
  it("a workflow already shutting down cannot be stopped again", () => {
    expect(workflowActions(wf("Running", { shutdown: "Stop" })).map((a) => a.id)).toEqual(["terminate", "suspend", "resubmit"]);
  });
});

describe("retryCommand", () => {
  const wf = (phase: string) => ({ metadata: { name: "build-0", namespace: "ci" }, spec: {}, status: { phase } });
  it.each(["Failed", "Error"])("a %s workflow gets the argo retry command", (p) => {
    expect(retryCommand(wf(p))).toBe("argo retry build-0 -n ci");
  });
  it.each(["Succeeded", "Running", "Pending"])("a %s workflow has none", (p) => {
    expect(retryCommand(wf(p))).toBeNull();
  });
});

describe("workflowActionRequest", () => {
  const target = { cluster: "kind-x", gvr: "argoproj.io/v1alpha1/workflows", ns: "ci", name: "wf" };
  it("stop sets spec.shutdown=Stop as a merge patch with its own audit action", () => {
    const r = workflowActionRequest(target, "stop");
    expect(r).toMatchObject({ cluster: "kind-x", gvr: target.gvr, ns: "ci", name: "wf", mode: "merge", dryRun: false, action: "argo-workflow-stop" });
    expect(JSON.parse(r.yaml)).toEqual({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Workflow",
      metadata: { name: "wf", namespace: "ci" },
      spec: { shutdown: "Stop" },
    });
  });
  it("terminate sets spec.shutdown=Terminate", () => {
    expect(JSON.parse(workflowActionRequest(target, "terminate").yaml).spec).toEqual({ shutdown: "Terminate" });
  });
  it("suspend sets spec.suspend=true and resume clears it", () => {
    expect(JSON.parse(workflowActionRequest(target, "suspend").yaml).spec).toEqual({ suspend: true });
    expect(JSON.parse(workflowActionRequest(target, "resume").yaml).spec).toEqual({ suspend: null });
  });
  it("a cron workflow is patched with its own kind", () => {
    const r = workflowActionRequest({ ...target, gvr: "argoproj.io/v1alpha1/cronworkflows", kind: "CronWorkflow" }, "suspend");
    expect(JSON.parse(r.yaml).kind).toBe("CronWorkflow");
    expect(r.action).toBe("argo-cronworkflow-suspend");
  });
  it("refuses resubmit (it is a create, not a patch)", () => {
    expect(() => workflowActionRequest(target, "resubmit")).toThrow();
  });
});

describe("resubmitManifest", () => {
  const wf = {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Workflow",
    metadata: {
      name: "build-abc12",
      namespace: "ci",
      uid: "u",
      resourceVersion: "9",
      labels: { team: "a", "workflows.argoproj.io/phase": "Failed", "workflows.argoproj.io/completed": "true" },
      annotations: { note: "x", "workflows.argoproj.io/pod-name-format": "v2" },
      ownerReferences: [{ kind: "CronWorkflow", name: "c" }],
    },
    spec: { entrypoint: "main", shutdown: "Stop", suspend: true, templates: [{ name: "main" }] },
    status: { phase: "Failed" },
  };
  it("builds a new Workflow with generateName from the old spec", () => {
    const m = JSON.parse(resubmitManifest(wf));
    expect(m.metadata.generateName).toBe("build-abc12-");
    expect(m.metadata.name).toBeUndefined();
    expect(m.metadata.namespace).toBe("ci");
    expect(m.spec.entrypoint).toBe("main");
    expect(m.status).toBeUndefined();
    expect(m.metadata.uid).toBeUndefined();
    expect(m.metadata.ownerReferences).toBeUndefined();
  });
  it("drops shutdown and suspend so the copy runs", () => {
    const m = JSON.parse(resubmitManifest(wf));
    expect(m.spec.shutdown).toBeUndefined();
    expect(m.spec.suspend).toBeUndefined();
  });
  it("keeps user labels and annotations but not controller ones, and notes the origin", () => {
    const m = JSON.parse(resubmitManifest(wf));
    expect(m.metadata.labels).toEqual({ team: "a" });
    expect(m.metadata.annotations.note).toBe("x");
    expect(m.metadata.annotations["workflows.argoproj.io/pod-name-format"]).toBeUndefined();
    expect(m.metadata.annotations["kubebay.dev/resubmitted-from"]).toBe("build-abc12");
  });
  it("uses the original generateName stem when there is one", () => {
    const m = JSON.parse(resubmitManifest({ ...wf, metadata: { ...wf.metadata, generateName: "build-" } }));
    expect(m.metadata.generateName).toBe("build-");
  });
  it("keeps the name stem short enough for a generated suffix", () => {
    const long = "x".repeat(200);
    const m = JSON.parse(resubmitManifest({ ...wf, metadata: { ...wf.metadata, name: long } }));
    expect(m.metadata.generateName.length).toBeLessThanOrEqual(64);
  });
});

describe("summarizeCronWorkflow", () => {
  const cw = (spec: Record<string, unknown>, status: Record<string, unknown> = {}) => ({
    metadata: { name: "nightly", namespace: "ci" },
    spec,
    status,
  });
  it("shows the schedule and a relative next run", () => {
    const s = summarizeCronWorkflow(cw({ schedule: "0 13 * * *" }), NOW);
    expect(s.schedule).toBe("0 13 * * *");
    expect(s.nextRun).toBe("in 1h");
    expect(s.suspended).toBe(false);
  });
  it("reads Argo's lower-case `timezone` field", () => {
    const utc = summarizeCronWorkflow(cw({ schedule: "0 13 * * *" }), NOW);
    const tokyo = summarizeCronWorkflow(cw({ schedule: "0 13 * * *", timezone: "Asia/Tokyo" }), NOW);
    expect(tokyo.timezone).toBe("Asia/Tokyo");
    expect(tokyo.nextRun).not.toBe(utc.nextRun);
  });
  it("uses the earliest of several schedules", () => {
    const s = summarizeCronWorkflow(cw({ schedules: ["0 18 * * *", "30 12 * * *"] }), NOW);
    expect(s.schedule).toBe("0 18 * * *, 30 12 * * *");
    expect(s.nextRun).toBe("in 30m");
  });
  it("a suspended cron has no next run", () => {
    const s = summarizeCronWorkflow(cw({ schedule: "0 13 * * *", suspend: true }), NOW);
    expect(s.suspended).toBe(true);
    expect(s.nextRun).toBe("–");
  });
  it("reports last scheduled time and active count", () => {
    const s = summarizeCronWorkflow(cw({ schedule: "* * * * *" }, { lastScheduledTime: "2026-11-19T11:00:00Z", active: [{ name: "a" }, { name: "b" }] }), NOW);
    expect(s.lastScheduled).toBe("2026-11-19T11:00:00Z");
    expect(s.active).toBe(2);
  });
  it("tolerates an invalid schedule", () => {
    expect(summarizeCronWorkflow(cw({ schedule: "nope" }), NOW).nextRun).toBe("–");
  });
});

describe("summarizeTemplate", () => {
  it("counts templates and reads the entrypoint", () => {
    const s = summarizeTemplate({
      metadata: { name: "t", namespace: "ci", creationTimestamp: "2026-11-18T00:00:00Z" },
      spec: { entrypoint: "main", templates: [{}, {}] },
    });
    expect(s).toEqual({ name: "t", ns: "ci", entrypoint: "main", templateCount: 2, created: "2026-11-18T00:00:00Z" });
  });
  it("has empty values for a bare object", () => {
    expect(summarizeTemplate({ metadata: { name: "c" } })).toMatchObject({ ns: "", entrypoint: "", templateCount: 0 });
  });
});
