type Obj = Record<string, unknown>;

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
function ts(v: unknown): number | undefined {
  const t = Date.parse(str(v));
  return Number.isNaN(t) ? undefined : t;
}

export type AttentionSeverity = "err" | "warn";

/** One broken workload on the Overview, worst first (Overview v2, docs/OVERVIEW_V2.md). */
export interface AttentionRow {
  /** "Kind/namespace/name". */
  key: string;
  kind: string;
  namespace: string;
  name: string;
  /** The Kubernetes term, kept so people can search for it (CrashLoopBackOff). */
  code: string;
  /** What it means, in words a developer reads at a glance. */
  plain: string;
  /** The reason's own message (the scheduler's "0/3 nodes are available…"). */
  detail: string;
  severity: AttentionSeverity;
  ready: number;
  desired: number;
  restarts: number;
  /** When the earliest of its pods went wrong, ms epoch. */
  since?: number;
  /** Its broken pods, "namespace/name", most restarts first. */
  pods: string[];
  /** The node to blame, when the reason is the node's. */
  node?: string;
  /** The workload object, for "Show pods" (undefined for a bare pod). */
  workload?: Obj;
}

export interface AttentionInput {
  pods: Obj[];
  deployments: Obj[];
  statefulSets: Obj[];
  daemonSets: Obj[];
  nodes: Obj[];
  now?: number;
}

const REASONS: Record<string, { plain: string; severity: AttentionSeverity }> = {
  CrashLoopBackOff: { plain: "Keeps crashing on start", severity: "err" },
  OOMKilled: { plain: "Runs out of memory", severity: "err" },
  ImagePullBackOff: { plain: "Can't download its image", severity: "err" },
  ErrImagePull: { plain: "Can't download its image", severity: "err" },
  InvalidImageName: { plain: "Its image name is invalid", severity: "err" },
  CreateContainerConfigError: { plain: "Missing a config map or secret it needs", severity: "err" },
  CreateContainerError: { plain: "Its container can't be created", severity: "err" },
  RunContainerError: { plain: "Its container can't be started", severity: "err" },
  Unschedulable: { plain: "Can't find room to start", severity: "err" },
  NodeNotReady: { plain: "Its node is down", severity: "err" },
  Failed: { plain: "Stopped with an error", severity: "err" },
  Evicted: { plain: "Was evicted from its node", severity: "warn" },
  MemoryPressure: { plain: "Its node is short on memory", severity: "warn" },
  DiskPressure: { plain: "Its node is short on disk", severity: "warn" },
  PIDPressure: { plain: "Its node is running out of processes", severity: "warn" },
  Pending: { plain: "Stuck starting", severity: "warn" },
  NotReady: { plain: "Running but not ready", severity: "warn" },
  MinimumReplicasUnavailable: { plain: "Not enough copies running", severity: "warn" },
};

function describe(code: string): { plain: string; severity: AttentionSeverity } {
  return REASONS[code] ?? { plain: "Waiting to start", severity: "warn" };
}

/** Pods older than this before Pending or not-ready counts as stuck. */
const GRACE_MS = 5 * 60_000;

interface PodProblem {
  code: string;
  detail: string;
  since?: number;
  node?: string;
}

function nodeTrouble(node: Obj | undefined): string | null {
  if (!node) return null;
  const conds = arr(rec(node.status).conditions);
  if (conds.find((c) => c.type === "Ready")?.status !== "True") return "NodeNotReady";
  for (const t of ["MemoryPressure", "DiskPressure", "PIDPressure"]) {
    if (conds.find((c) => c.type === t)?.status === "True") return t;
  }
  return null;
}

/** Why one pod needs attention, or null when it is fine (or finished, or going away). */
function podProblem(pod: Obj, nodes: Map<string, Obj>, now: number): PodProblem | null {
  const meta = rec(pod.metadata);
  const status = rec(pod.status);
  if (meta.deletionTimestamp) return null;
  const phase = str(status.phase);
  if (phase === "Succeeded") return null;

  const conds = arr(status.conditions);
  const notReady = conds.find((c) => c.type === "Ready" && c.status === "False");
  const created = ts(meta.creationTimestamp);
  const since = ts(notReady?.lastTransitionTime) ?? created;

  if (phase === "Failed") {
    const code = str(status.reason) === "Evicted" ? "Evicted" : "Failed";
    return { code, detail: str(status.message), since: created };
  }

  const statuses = arr(status.containerStatuses);
  for (const cs of statuses) {
    const waiting = rec(rec(cs.state).waiting);
    const reason = str(waiting.reason);
    if (!reason || reason === "ContainerCreating" || reason === "PodInitializing") continue;
    const oom = str(rec(rec(cs.lastState).terminated).reason) === "OOMKilled";
    return { code: oom ? "OOMKilled" : reason, detail: str(waiting.message), since };
  }

  const unsched = conds.find((c) => c.type === "PodScheduled" && c.status === "False" && c.reason === "Unschedulable");
  if (unsched) return { code: "Unschedulable", detail: str(unsched.message), since: ts(unsched.lastTransitionTime) ?? created };

  const nodeName = str(rec(pod.spec).nodeName);
  const allReady = statuses.length > 0 && statuses.every((cs) => cs.ready === true);
  if (!allReady && nodeName) {
    const trouble = nodeTrouble(nodes.get(nodeName));
    if (trouble) return { code: trouble, detail: "", since, node: nodeName };
  }
  if (phase === "Pending") {
    return created !== undefined && now - created > GRACE_MS ? { code: "Pending", detail: "", since: created } : null;
  }
  if (!allReady && since !== undefined && now - since > GRACE_MS) return { code: "NotReady", detail: "", since };
  return null;
}

/**
 * Whether a pod needs attention, judged from the pod alone (no node trouble).
 * The engine records the same rule per hour for the drawer's 7-day chip; both
 * sides run the fixtures in __fixtures__/podBroken.json.
 */
export function podBroken(pod: Obj, now = Date.now()): boolean {
  return podProblem(pod, new Map(), now) !== null;
}

/** The workload a pod belongs to: a ReplicaSet's pods belong to its Deployment. */
function ownerOf(pod: Obj): { kind: string; name: string } {
  const meta = rec(pod.metadata);
  const ref = arr(meta.ownerReferences).find((r) => r.controller === true);
  if (!ref) return { kind: "Pod", name: str(meta.name) };
  const kind = str(ref.kind);
  const name = str(ref.name);
  if (kind === "ReplicaSet") {
    const hash = str(rec(meta.labels)["pod-template-hash"]);
    if (hash && name.endsWith(`-${hash}`)) return { kind: "Deployment", name: name.slice(0, -hash.length - 1) };
  }
  return { kind, name };
}

function podReady(pod: Obj): boolean {
  const statuses = arr(rec(pod.status).containerStatuses);
  return statuses.length > 0 && statuses.every((cs) => cs.ready === true);
}

function podRestarts(pod: Obj): number {
  return arr(rec(pod.status).containerStatuses).reduce((n, cs) => n + num(cs.restartCount), 0);
}

function readyOf(kind: string, obj: Obj): { ready: number; desired: number } {
  const spec = rec(obj.spec);
  const status = rec(obj.status);
  if (kind === "DaemonSet") return { ready: num(status.numberReady), desired: num(status.desiredNumberScheduled) };
  return { ready: num(status.readyReplicas), desired: typeof spec.replicas === "number" ? spec.replicas : 1 };
}

const nsName = (o: Obj) => `${str(rec(o.metadata).namespace)}/${str(rec(o.metadata).name)}`;

/**
 * Every workload that needs attention now, failures before warnings, then by
 * how many pods are broken. A pod's reason prefers its container's own
 * (CrashLoopBackOff, with OOMKilled named when that is why), then the
 * scheduler's, then its node's; Pending and not-ready only count after 5 min.
 */
export function findAttention(input: AttentionInput): AttentionRow[] {
  const now = input.now ?? Date.now();
  const nodes = new Map(input.nodes.map((n) => [str(rec(n.metadata).name), n]));
  const workloads = new Map<string, Obj>();
  for (const [kind, list] of [["Deployment", input.deployments], ["StatefulSet", input.statefulSets], ["DaemonSet", input.daemonSets]] as const) {
    for (const o of list) workloads.set(`${kind}/${nsName(o)}`, o);
  }

  interface Group { kind: string; ns: string; name: string; total: number; ready: number; broken: { key: string; restarts: number; p: PodProblem }[] }
  const groups = new Map<string, Group>();
  for (const pod of input.pods) {
    const meta = rec(pod.metadata);
    if (meta.deletionTimestamp || str(rec(pod.status).phase) === "Succeeded") continue;
    const ns = str(meta.namespace);
    const owner = ownerOf(pod);
    const key = `${owner.kind}/${ns}/${owner.name}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { kind: owner.kind, ns, name: owner.name, total: 0, ready: 0, broken: [] }));
    g.total++;
    if (podReady(pod)) g.ready++;
    const problem = podProblem(pod, nodes, now);
    if (problem) g.broken.push({ key: `${ns}/${str(meta.name)}`, restarts: podRestarts(pod), p: problem });
  }

  const rows: AttentionRow[] = [];
  for (const [key, g] of groups) {
    if (g.broken.length === 0) continue;
    // The worst reason: failures first, then the most common.
    const tally = new Map<string, number>();
    for (const b of g.broken) tally.set(b.p.code, (tally.get(b.p.code) ?? 0) + 1);
    const code = [...tally.keys()].sort(
      (a, b) => Number(describe(a).severity === "warn") - Number(describe(b).severity === "warn") || tally.get(b)! - tally.get(a)!,
    )[0]!;
    const first = g.broken.find((b) => b.p.code === code)!;
    const workload = workloads.get(key);
    const counts = workload ? readyOf(g.kind, workload) : { ready: g.ready, desired: g.total };
    const starts = g.broken.map((b) => b.p.since).filter((t): t is number => t !== undefined);
    rows.push({
      key,
      kind: g.kind,
      namespace: g.ns,
      name: g.name,
      code,
      ...describe(code),
      detail: first.p.detail,
      ...counts,
      restarts: g.broken.reduce((n, b) => n + b.restarts, 0),
      since: starts.length ? Math.min(...starts) : undefined,
      pods: [...g.broken].sort((a, b) => b.restarts - a.restarts || a.key.localeCompare(b.key)).map((b) => b.key),
      node: first.p.node,
      workload,
    });
  }

  // A Deployment short of copies with no pod to blame (a quota, a deleted pod).
  for (const d of input.deployments) {
    const key = `Deployment/${nsName(d)}`;
    if (rows.some((r) => r.key === key)) continue;
    const cond = arr(rec(d.status).conditions).find((c) => c.type === "Available" && c.status === "False");
    const { ready, desired } = readyOf("Deployment", d);
    if (!cond || ready >= desired) continue;
    const meta = rec(d.metadata);
    rows.push({
      key,
      kind: "Deployment",
      namespace: str(meta.namespace),
      name: str(meta.name),
      code: "MinimumReplicasUnavailable",
      ...describe("MinimumReplicasUnavailable"),
      detail: str(cond.message),
      ready,
      desired,
      restarts: 0,
      since: ts(cond.lastTransitionTime),
      pods: [],
      workload: d,
    });
  }

  return rows.sort(
    (a, b) =>
      Number(a.severity === "warn") - Number(b.severity === "warn") ||
      b.pods.length - a.pods.length ||
      a.name.localeCompare(b.name),
  );
}
