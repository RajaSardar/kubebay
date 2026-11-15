import type { ReleaseResource } from "./api";
import type { StreamState } from "./useResourceStream";
import { findAttention } from "./attention";

// ADR 0004 S9: what a Helm release created, live. The objects are joined in
// the browser against streams the Overview opens in the namespaces the
// release uses (cluster-wide for a cluster-scoped kind). Each subscription is
// sent its own snapshot, so the cluster-wide streams Kubebay keeps from the
// moment a cluster connects aren't shared: they'd send every object of the
// kind in the cluster. The engine's informers are per namespace and shared,
// so a page already watching the namespace costs the API server nothing more.
// A stream RBAC refuses makes an object "can't check", never "missing".

type Obj = Record<string, unknown>;

export type LiveState = "ready" | "progressing" | "not-ready" | "present" | "missing" | "checking" | "cant-check";

export interface LiveStatus {
  state: LiveState;
  why?: string;
}

export interface LiveStreamSpec {
  key: string;
  gvr: string;
  mode: "full" | "metadata";
  /** The namespaces to stream; cluster-wide when absent. */
  ns?: string[];
}

/** Kinds whose health is in their status: streamed whole. Everything else is only there or not. */
const FULL = new Set([
  "apps/v1/deployments",
  "apps/v1/statefulsets",
  "apps/v1/daemonsets",
  "batch/v1/jobs",
  "v1/pods",
  "v1/persistentvolumeclaims",
]);

/** Workloads whose pods say why they aren't ready. */
const WORKLOADS = new Set(["Deployment", "StatefulSet", "DaemonSet"]);

const PODS = "v1/pods";

function rec(v: unknown): Obj {
  return (v ?? {}) as Obj;
}
function arr(v: unknown): Obj[] {
  return Array.isArray(v) ? (v as Obj[]) : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

export function resourceKey(r: ReleaseResource): string {
  return `${r.apiVersion}/${r.kind}/${r.namespace ?? ""}/${r.name}`;
}

function gvrOf(r: ReleaseResource): string | undefined {
  return r.served && r.resource ? `${r.apiVersion}/${r.resource}` : undefined;
}

function spec(gvr: string, mode: "full" | "metadata", ns?: string[]): LiveStreamSpec {
  return { key: `${gvr}|${mode}|${ns?.join(",") ?? "*"}`, gvr, mode, ns };
}

/**
 * The streams a release's objects are joined against, in the order its kinds
 * first appear: each namespaced kind in the namespaces the release puts it
 * in, each cluster-scoped kind cluster-wide. Pods are streamed only in
 * `podsIn`, the namespaces of workloads that aren't ready, to say why.
 */
export function releaseStreams(resources: ReleaseResource[], podsIn: readonly string[]): LiveStreamSpec[] {
  const kinds = new Map<string, { namespaced: boolean; ns: Set<string> }>();
  for (const r of resources) {
    const gvr = gvrOf(r);
    if (!gvr) continue;
    let k = kinds.get(gvr);
    if (!k) kinds.set(gvr, (k = { namespaced: r.namespaced, ns: new Set() }));
    if (r.namespace) k.ns.add(r.namespace);
  }
  if (podsIn.length > 0) {
    const pods = kinds.get(PODS) ?? { namespaced: true, ns: new Set<string>() };
    for (const ns of podsIn) pods.ns.add(ns);
    kinds.set(PODS, pods);
  }
  return [...kinds].map(([gvr, k]) => spec(gvr, FULL.has(gvr) ? "full" : "metadata", k.namespaced ? [...k.ns].sort() : undefined));
}

/** The namespaces of the release's workloads that aren't ready: their pods say why. */
export function podsNeededIn(resources: ReleaseResource[], statuses: Map<string, LiveStatus>): string[] {
  const ns = resources
    .filter((r) => WORKLOADS.has(r.kind) && r.namespace && statuses.get(resourceKey(r))?.state === "not-ready")
    .map((r) => r.namespace!);
  return [...new Set(ns)].sort();
}

/** The stream each GVR is read from. */
export function streamPicker(specs: LiveStreamSpec[], states: Record<string, StreamState | undefined>): (gvr: string) => StreamState | undefined {
  return (gvr) => {
    const s = specs.find((x) => x.gvr === gvr);
    return s ? states[s.key] : undefined;
  };
}

const plain = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function conditionTrue(obj: Obj, type: string): Obj | undefined {
  return arr(rec(obj.status).conditions).find((c) => c.type === type && c.status === "True");
}

/** Why a workload's pods aren't ready, in the Overview's words, if they say. */
function podsWhy(kind: string, obj: Obj, pods: Obj[]): string {
  const ns = str(rec(obj.metadata).namespace);
  const name = str(rec(obj.metadata).name);
  const row = findAttention({
    pods: pods.filter((p) => str(rec(p.metadata).namespace) === ns),
    deployments: kind === "Deployment" ? [obj] : [],
    statefulSets: kind === "StatefulSet" ? [obj] : [],
    daemonSets: kind === "DaemonSet" ? [obj] : [],
    nodes: [],
  }).find((r) => r.kind === kind && r.namespace === ns && r.name === name && r.code !== "MinimumReplicasUnavailable");
  return row ? `: ${plain(row.plain)}` : "";
}

/** One object's health from what its kind reports about itself. */
function health(kind: string, obj: Obj, pods: Obj[] | undefined, now: number): LiveStatus {
  const meta = rec(obj.metadata);
  const spec = rec(obj.spec);
  const status = rec(obj.status);
  const behind = num(status.observedGeneration) < num(meta.generation);
  switch (kind) {
    case "Deployment": {
      const desired = typeof spec.replicas === "number" ? spec.replicas : 1;
      const updated = num(status.updatedReplicas);
      const available = num(status.availableReplicas);
      const progressing = arr(status.conditions).find((c) => c.type === "Progressing");
      if (str(progressing?.reason) === "ProgressDeadlineExceeded") return { state: "not-ready", why: "its rollout passed its deadline" };
      if (behind || updated < desired || num(status.replicas) > updated) return { state: "progressing", why: `${updated} of ${desired} updated` };
      if (available < desired) return { state: "not-ready", why: `${available} of ${desired} available${podsWhy(kind, obj, pods ?? [])}` };
      return { state: "ready", why: `${num(status.readyReplicas)} of ${desired} ready` };
    }
    case "StatefulSet": {
      const desired = typeof spec.replicas === "number" ? spec.replicas : 1;
      const ready = num(status.readyReplicas);
      const updated = num(status.updatedReplicas);
      const onDelete = str(rec(spec.updateStrategy).type) === "OnDelete";
      if (behind || (!onDelete && str(status.updateRevision) !== str(status.currentRevision)))
        return { state: "progressing", why: `${updated} of ${desired} updated` };
      if (ready < desired) return { state: "not-ready", why: `${ready} of ${desired} ready${podsWhy(kind, obj, pods ?? [])}` };
      return { state: "ready", why: `${ready} of ${desired} ready` };
    }
    case "DaemonSet": {
      const desired = num(status.desiredNumberScheduled);
      const updated = num(status.updatedNumberScheduled);
      const available = num(status.numberAvailable);
      const onDelete = str(rec(spec.updateStrategy).type) === "OnDelete";
      if (behind || (!onDelete && updated < desired)) return { state: "progressing", why: `${updated} of ${desired} updated` };
      if (available < desired) return { state: "not-ready", why: `${available} of ${desired} available${podsWhy(kind, obj, pods ?? [])}` };
      return { state: "ready", why: `${num(status.numberReady)} of ${desired} ready` };
    }
    case "Job": {
      if (conditionTrue(obj, "Complete")) return { state: "ready", why: "complete" };
      const failed = conditionTrue(obj, "Failed");
      if (failed) return { state: "not-ready", why: str(failed.message) || str(failed.reason) || "failed" };
      if (spec.suspend === true) return { state: "present", why: "suspended" };
      return { state: "progressing", why: "running" };
    }
    case "Pod": {
      const phase = str(status.phase);
      if (phase === "Succeeded") return { state: "ready", why: "completed" };
      if (phase === "Running" && conditionTrue(obj, "Ready")) return { state: "ready" };
      const why = findAttention({ pods: [obj], deployments: [], statefulSets: [], daemonSets: [], nodes: [], now })[0];
      if (why) return { state: "not-ready", why: plain(why.plain) };
      return { state: "progressing", why: "starting" };
    }
    case "PersistentVolumeClaim": {
      const phase = str(status.phase);
      if (phase === "Bound") return { state: "ready", why: "bound" };
      if (phase === "Lost") return { state: "not-ready", why: "its volume is gone" };
      return { state: "progressing", why: "waiting for a volume" };
    }
    default:
      return { state: "present" };
  }
}

/**
 * Each served object's live status, by resourceKey. `streamFor` gives the
 * stream an object of that GVR is read from.
 */
export function joinReleaseResources(
  resources: ReleaseResource[],
  streamFor: (gvr: string) => StreamState | undefined,
  now = Date.now(),
): Map<string, LiveStatus> {
  const out = new Map<string, LiveStatus>();
  const indexes = new Map<string, Map<string, Obj>>();
  const index = (gvr: string, s: StreamState) => {
    let m = indexes.get(gvr);
    if (!m) {
      m = new Map(s.rows.map((o) => [`${str(rec(o.metadata).namespace)}/${str(rec(o.metadata).name)}`, o]));
      indexes.set(gvr, m);
    }
    return m;
  };
  const pods = streamFor(PODS);
  const usablePods = pods && !pods.forbidden ? pods.rows : undefined;

  for (const r of resources) {
    const gvr = gvrOf(r);
    if (!gvr) continue;
    const s = streamFor(gvr);
    if (!s) {
      out.set(resourceKey(r), { state: "checking" });
      continue;
    }
    if (s.forbidden) {
      out.set(resourceKey(r), { state: "cant-check", why: s.forbidden });
      continue;
    }
    const denied = r.namespace ? s.denied?.find((d) => d.ns === r.namespace) : undefined;
    if (denied) {
      out.set(resourceKey(r), { state: "cant-check", why: denied.reason });
      continue;
    }
    const obj = index(gvr, s).get(`${r.namespaced ? (r.namespace ?? "") : ""}/${r.name}`);
    if (obj) out.set(resourceKey(r), health(r.kind, obj, usablePods, now));
    else out.set(resourceKey(r), s.synced ? { state: "missing", why: "not in the cluster" } : { state: "checking" });
  }
  return out;
}

const SUMMARY: [string, (s: LiveState) => boolean][] = [
  ["missing", (s) => s === "missing"],
  ["not ready", (s) => s === "not-ready"],
  ["progressing", (s) => s === "progressing"],
  ["ok", (s) => s === "ready" || s === "present"],
  ["can't check", (s) => s === "cant-check"],
];

/** "1 missing · 3 ok", the worst first; "checking…" until every object is known. */
export function liveSummary(statuses: LiveStatus[]): string {
  if (statuses.some((s) => s.state === "checking")) return "checking…";
  return SUMMARY.map(([label, is]) => [statuses.filter((s) => is(s.state)).length, label] as const)
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(" · ");
}
