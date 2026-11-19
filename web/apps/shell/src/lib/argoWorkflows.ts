import type { CRDEntry } from "./api";
import { cronNextRun, nextRunCell } from "./cron";

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const GROUP = "argoproj.io";

export interface ArgoWorkflowsDetection {
  installed: boolean;
  workflowGvr?: string;
  templateGvr?: string;
  clusterTemplateGvr?: string;
  cronGvr?: string;
}

/**
 * Argo Workflows shares the `argoproj.io` group with Argo CD and Rollouts, so
 * detection is by resource name within the group, like KEDA/Flux detection
 * over the existing /api/crds list. Any one of the four kinds counts.
 */
export function detectArgoWorkflows(crds: CRDEntry[]): ArgoWorkflowsDetection {
  const find = (resource: string) => crds.find((c) => c.group === GROUP && c.resource === resource)?.gvr;
  const workflowGvr = find("workflows");
  const templateGvr = find("workflowtemplates");
  const clusterTemplateGvr = find("clusterworkflowtemplates");
  const cronGvr = find("cronworkflows");
  return {
    installed: !!(workflowGvr || templateGvr || clusterTemplateGvr || cronGvr),
    workflowGvr,
    templateGvr,
    clusterTemplateGvr,
    cronGvr,
  };
}

/** 45s, 2m 5s, 1h 2m, 1d 1h. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export interface WorkflowSummary {
  name: string;
  ns: string;
  phase: string;
  progress: { done: number; total: number } | null;
  progressText: string;
  durationMs: number | null;
  durationText: string;
  startedAt: string;
  message: string;
  suspended: boolean;
}

function progressOf(status: Record<string, unknown>): { done: number; total: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(str(status.progress));
  if (m) return { done: Number(m[1]), total: Number(m[2]) };
  const pods = Object.values(rec(status.nodes))
    .map(rec)
    .filter((n) => str(n.type) === "Pod");
  if (pods.length === 0) return null;
  return { done: pods.filter((n) => str(n.phase) === "Succeeded").length, total: pods.length };
}

/** One Workflows list row: phase, x/y progress, duration (to now while running). */
export function summarizeWorkflow(wf: Record<string, unknown>, now: Date): WorkflowSummary {
  const meta = rec(wf.metadata);
  const status = rec(wf.status);
  const progress = progressOf(status);
  const startedAt = str(status.startedAt);
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const finished = str(status.finishedAt) ? Date.parse(str(status.finishedAt)) : NaN;
  const durationMs = Number.isNaN(start) ? null : Math.max(0, (Number.isNaN(finished) ? now.getTime() : finished) - start);
  return {
    name: str(meta.name),
    ns: str(meta.namespace),
    phase: str(status.phase) || "Pending",
    progress,
    progressText: progress ? `${progress.done}/${progress.total}` : "–",
    durationMs,
    durationText: durationMs === null ? "–" : formatDuration(durationMs),
    startedAt,
    message: str(status.message),
    suspended: rec(wf.spec).suspend === true,
  };
}

export interface WorkflowNodeRow {
  id: string;
  name: string;
  displayName: string;
  type: string;
  phase: string;
  message: string;
  depth: number;
  templateName: string;
}

/**
 * status.nodes flattened depth-first from the root node (whose id is the
 * workflow's name). A node reachable by several parents (a DAG join) is listed
 * once, under the first; nodes unreachable from the root follow at depth 0.
 */
export function buildNodeTree(wf: Record<string, unknown>): WorkflowNodeRow[] {
  const nodes = rec(rec(wf.status).nodes);
  const ids = Object.keys(nodes);
  if (ids.length === 0) return [];
  const rootName = str(rec(wf.metadata).name);
  const seen = new Set<string>();
  const out: WorkflowNodeRow[] = [];
  const visit = (id: string, depth: number) => {
    if (seen.has(id) || !(id in nodes)) return;
    seen.add(id);
    const n = rec(nodes[id]);
    out.push({
      id,
      name: str(n.name),
      displayName: str(n.displayName) || str(n.name) || id,
      type: str(n.type),
      phase: str(n.phase),
      message: str(n.message),
      depth,
      templateName: str(n.templateName),
    });
    for (const c of arr(n.children)) visit(str(c), depth + 1);
  };
  visit(rootName in nodes ? rootName : ids[0]!, 0);
  for (const id of ids) visit(id, 0);
  return out;
}

const WF_LABEL = "workflows.argoproj.io/workflow";
const NODE_NAME = "workflows.argoproj.io/node-name";
const NODE_ID = "workflows.argoproj.io/node-id";

/**
 * Pod name per Pod-type node id. Argo's pod names are hashed in newer
 * versions, so match on the pod's node-name / node-id annotations, then on a
 * pod named exactly like the node id (the older scheme).
 */
export function matchNodePods(wfName: string, nodes: WorkflowNodeRow[], pods: Record<string, unknown>[]): Map<string, string> {
  const mine = pods.filter((p) => str(rec(rec(p.metadata).labels)[WF_LABEL]) === wfName);
  const out = new Map<string, string>();
  for (const n of nodes) {
    if (n.type !== "Pod") continue;
    const hit =
      mine.find((p) => str(rec(rec(p.metadata).annotations)[NODE_ID]) === n.id) ??
      mine.find((p) => n.name !== "" && str(rec(rec(p.metadata).annotations)[NODE_NAME]) === n.name) ??
      mine.find((p) => str(rec(p.metadata).name) === n.id);
    if (hit) out.set(n.id, str(rec(hit.metadata).name));
  }
  return out;
}

export type WorkflowActionId = "stop" | "terminate" | "suspend" | "resume" | "resubmit";

export interface WorkflowAction {
  id: WorkflowActionId;
  label: string;
}

const LABELS: Record<WorkflowActionId, string> = {
  stop: "Stop",
  terminate: "Terminate",
  suspend: "Suspend",
  resume: "Resume",
  resubmit: "Resubmit",
};

/**
 * Only operations that are one small patch (spec.shutdown, spec.suspend) or a
 * plain create (resubmit). Retry is left out: Argo implements it by rewriting
 * status.nodes, which is not a safe thing to do from here.
 */
export function workflowActions(wf: Record<string, unknown>): WorkflowAction[] {
  const spec = rec(wf.spec);
  const phase = str(rec(wf.status).phase) || "Pending";
  const ids: WorkflowActionId[] = [];
  if (phase === "Running" || phase === "Pending") {
    const shutdown = str(spec.shutdown);
    if (!shutdown) ids.push("stop");
    if (shutdown !== "Terminate") ids.push("terminate");
    ids.push(spec.suspend === true ? "resume" : "suspend");
  }
  ids.push("resubmit");
  return ids.map((id) => ({ id, label: LABELS[id] }));
}

export interface WorkflowTarget {
  cluster: string;
  gvr: string;
  ns: string;
  name: string;
  /** "Workflow" (default) or "CronWorkflow". */
  kind?: string;
}

/** The PUT /api/yaml body for a patch action: a JSON merge patch (null deletes a field). */
export function workflowActionRequest(target: WorkflowTarget, action: WorkflowActionId) {
  const kind = target.kind ?? "Workflow";
  let spec: Record<string, unknown>;
  switch (action) {
    case "stop":
      spec = { shutdown: "Stop" };
      break;
    case "terminate":
      spec = { shutdown: "Terminate" };
      break;
    case "suspend":
      spec = { suspend: true };
      break;
    case "resume":
      spec = { suspend: null };
      break;
    default:
      throw new Error(`${action} is not a patch`);
  }
  if (kind === "CronWorkflow" && (action === "stop" || action === "terminate")) {
    throw new Error(`${action} does not apply to a CronWorkflow`);
  }
  const [group = GROUP, version = "v1alpha1"] = target.gvr.split("/");
  const yaml = JSON.stringify({
    apiVersion: `${group}/${version}`,
    kind,
    metadata: { name: target.name, namespace: target.ns },
    spec,
  });
  return {
    cluster: target.cluster,
    gvr: target.gvr,
    ns: target.ns,
    name: target.name,
    yaml,
    dryRun: false,
    force: false,
    mode: "merge" as const,
    action: `argo-${kind.toLowerCase()}-${action}`,
  };
}

const CONTROLLER_PREFIX = "workflows.argoproj.io/";

function userEntries(m: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(m))) {
    if (!k.startsWith(CONTROLLER_PREFIX) && typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * A new Workflow from an old one's spec, named by generateName so the API
 * server picks the suffix. spec.shutdown and spec.suspend are dropped (the
 * copy must run), status and server-set metadata are left behind, and
 * Argo's own labels/annotations are not copied.
 */
export function resubmitManifest(wf: Record<string, unknown>): string {
  const meta = rec(wf.metadata);
  const spec = { ...rec(wf.spec) };
  delete spec.shutdown;
  delete spec.suspend;
  const name = str(meta.name);
  const stem = str(meta.generateName) || `${name}-`;
  const generateName = stem.length > 64 ? `${stem.slice(0, 63)}-` : stem;
  const annotations = { ...userEntries(meta.annotations), "kubebay.dev/resubmitted-from": name };
  const labels = userEntries(meta.labels);
  const metadata: Record<string, unknown> = { generateName, namespace: str(meta.namespace), annotations };
  if (Object.keys(labels).length > 0) metadata.labels = labels;
  return JSON.stringify({ apiVersion: str(wf.apiVersion) || `${GROUP}/v1alpha1`, kind: "Workflow", metadata, spec });
}

export interface CronWorkflowSummary {
  name: string;
  ns: string;
  schedule: string;
  timezone: string;
  suspended: boolean;
  nextRun: string;
  nextRunTitle?: string;
  lastScheduled: string;
  active: number;
}

/** A CronWorkflow row. Argo spells the zone `timezone` (CronJob says `timeZone`) and may list several `schedules`. */
export function summarizeCronWorkflow(cw: Record<string, unknown>, now: Date): CronWorkflowSummary {
  const meta = rec(cw.metadata);
  const spec = rec(cw.spec);
  const status = rec(cw.status);
  const schedules = arr(spec.schedules).map(str).filter(Boolean);
  if (schedules.length === 0 && str(spec.schedule)) schedules.push(str(spec.schedule));
  const timezone = str(spec.timezone);
  const suspended = spec.suspend === true;

  let best: { t: number; schedule: string } | null = null;
  for (const s of schedules) {
    const t = cronNextRun(s, now, timezone || undefined);
    if (t && (!best || t.getTime() < best.t)) best = { t: t.getTime(), schedule: s };
  }
  const cell = best
    ? nextRunCell({ spec: { schedule: best.schedule, timeZone: timezone, suspend: suspended } }, now)
    : { v: "–", title: undefined };

  return {
    name: str(meta.name),
    ns: str(meta.namespace),
    schedule: schedules.join(", "),
    timezone,
    suspended,
    nextRun: cell.v,
    nextRunTitle: cell.title,
    lastScheduled: str(status.lastScheduledTime),
    active: arr(status.active).length,
  };
}

export interface TemplateSummary {
  name: string;
  ns: string;
  entrypoint: string;
  templateCount: number;
  created: string;
}

export function summarizeTemplate(t: Record<string, unknown>): TemplateSummary {
  const meta = rec(t.metadata);
  const spec = rec(t.spec);
  return {
    name: str(meta.name),
    ns: str(meta.namespace),
    entrypoint: str(spec.entrypoint),
    templateCount: arr(spec.templates).length,
    created: str(meta.creationTimestamp),
  };
}
