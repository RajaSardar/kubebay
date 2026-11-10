import type { CRDEntry } from "./api";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return fallback;
}

const TRIGGER_LABELS: Record<string, string> = {
  cpu: "CPU utilization",
  memory: "memory utilization",
  prometheus: "a Prometheus query",
  kafka: "Kafka consumer lag",
  rabbitmq: "RabbitMQ queue depth",
  "aws-sqs-queue": "an AWS SQS queue",
  "azure-queue": "an Azure Storage queue",
  "gcp-pubsub": "a GCP Pub/Sub subscription",
  redis: "a Redis list/stream",
};

interface Trigger {
  type: string;
  metadata: Record<string, unknown>;
}

function triggers(so: Record<string, unknown>): Trigger[] {
  const list = rec(so.spec).triggers;
  if (!Array.isArray(list)) return [];
  return list.map((t) => {
    const tt = rec(t);
    return { type: str(tt.type), metadata: rec(tt.metadata) };
  });
}

function describeTrigger(t: Trigger): string {
  if (t.type === "cron") {
    const tz = str(t.metadata.timezone) || "UTC";
    const start = str(t.metadata.start);
    const end = str(t.metadata.end);
    const desired = str(t.metadata.desiredReplicas);
    const schedule = start && end ? `${start} → ${end}` : "a schedule";
    return `on a cron trigger (${schedule}, ${tz})${desired ? ` scaling to ${desired} replicas` : ""}`;
  }
  const label = TRIGGER_LABELS[t.type];
  return label ? `on ${label}` : `on its "${t.type}" trigger`;
}

export interface KedaPause {
  paused: boolean;
  /** For the Paused column: "Yes", "Yes, at 0 replicas" or "No". */
  label: string;
  /** The count paused-replicas holds the workload at. */
  replicas?: number;
}

/** The annotations KEDA reads to pause a ScaledObject or ScaledJob. */
export const KEDA_PAUSED = "autoscaling.keda.sh/paused";
export const KEDA_PAUSED_REPLICAS = "autoscaling.keda.sh/paused-replicas";

/**
 * Whether KEDA has stopped scaling this ScaledObject or ScaledJob (root
 * backlog #24). KEDA pauses through annotations: paused-replicas holds the
 * workload at that count (KEDA 2.7+), paused: "true" holds it where it stands
 * (2.13+). The Paused condition KEDA reports counts too.
 */
export function kedaPause(obj: Record<string, unknown>): KedaPause {
  const ann = rec(rec(obj.metadata).annotations);
  const at = str(ann[KEDA_PAUSED_REPLICAS]).trim();
  if (at !== "" && Number.isInteger(Number(at))) {
    const n = Number(at);
    return { paused: true, label: `Yes, at ${n} replica${n === 1 ? "" : "s"}`, replicas: n };
  }
  if (str(ann[KEDA_PAUSED]).toLowerCase() === "true") return { paused: true, label: "Yes" };
  const conditions = rec(obj.status).conditions;
  if (Array.isArray(conditions) && conditions.some((c) => str(rec(c).type) === "Paused" && str(rec(c).status) === "True")) {
    return { paused: true, label: "Yes" };
  }
  return { paused: false, label: "No" };
}

export interface ScaledObjectExplain {
  name: string;
  ns: string;
  targetName: string;
  targetKind: string;
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number | undefined;
  minReplicaZero: boolean;
  paused: boolean;
  triggerDescriptions: string[];
  summary: string;
}

/**
 * Decodes a KEDA ScaledObject into a plain-English summary — backlog #2's
 * P2 "read-only explain" ("scales 1→20 on cron Mon-Fri 09:00"). Anything not
 * in the trigger label map falls back to its raw type name rather than being
 * silently dropped, since an unrecognized trigger is still worth surfacing.
 */
export function explainScaledObject(so: Record<string, unknown>): ScaledObjectExplain {
  const meta = rec(so.metadata);
  const spec = rec(so.spec);
  const targetRef = rec(spec.scaleTargetRef);
  const minReplicas = num(spec.minReplicaCount, 0);
  const maxReplicas = num(spec.maxReplicaCount, 100);
  const currentReplicas = typeof rec(so.status).currentReplicas === "number" ? (rec(so.status).currentReplicas as number) : undefined;
  const trigs = triggers(so);
  const triggerDescriptions = trigs.map(describeTrigger);
  const targetName = str(targetRef.name);
  const targetKind = str(targetRef.kind) || "Deployment";
  const paused = kedaPause(so).paused;

  const triggerClause = triggerDescriptions.length > 0 ? ` ${triggerDescriptions.join(" and ")}` : "";
  const summary = `Scales ${targetKind.toLowerCase()} "${targetName}" ${minReplicas}→${maxReplicas}${triggerClause}`;

  return {
    name: str(meta.name),
    ns: str(meta.namespace),
    targetName,
    targetKind,
    minReplicas,
    maxReplicas,
    currentReplicas,
    minReplicaZero: minReplicas === 0,
    paused,
    triggerDescriptions,
    summary,
  };
}

/**
 * Detects the #1 real-world KEDA failure per the backlog: an HPA and a
 * ScaledObject both targeting the same workload, fighting over replica
 * count. Namespace is implied by both objects living in the same drawer
 * context, so only kind+name need to match.
 */
export function hpaConflictsWithScaledObject(so: Record<string, unknown>, hpas: Record<string, unknown>[]): boolean {
  const targetRef = rec(rec(so.spec).scaleTargetRef);
  const targetName = str(targetRef.name);
  const targetKind = str(targetRef.kind) || "Deployment";
  return hpas.some((h) => {
    const ref = rec(rec(h.spec).scaleTargetRef);
    return str(ref.name) === targetName && (str(ref.kind) || "Deployment") === targetKind;
  });
}

/** The KEDA kinds the KEDA page lists, by their resource name. */
export type KedaKind = "scaledobjects" | "scaledjobs" | "triggerauthentications" | "clustertriggerauthentications";

export interface KedaDetection {
  /** KEDA is installed: its ScaledObject CRD is served. */
  installed: boolean;
  /** The GVR of each KEDA kind the cluster serves. */
  gvrs: Partial<Record<KedaKind, string>>;
}

const KEDA_KINDS: KedaKind[] = ["scaledobjects", "scaledjobs", "triggerauthentications", "clustertriggerauthentications"];

/**
 * Fleet-wide KEDA detection (backlog: KEDA nav placement). Same free,
 * client-side /api/crds filter AutoscalingTab already uses per-workload —
 * no engine changes, no new resource kind.
 */
export function detectKeda(crds: CRDEntry[]): KedaDetection {
  const gvrs: Partial<Record<KedaKind, string>> = {};
  for (const kind of KEDA_KINDS) {
    const crd = crds.find((c) => c.group === "keda.sh" && c.resource === kind);
    if (crd) gvrs[kind] = crd.gvr;
  }
  return { installed: !!gvrs.scaledobjects, gvrs };
}

function referencedAuths(so: Record<string, unknown>): { name: string; kind: string }[] {
  const trigs = rec(so.spec).triggers;
  if (!Array.isArray(trigs)) return [];
  return trigs
    .map((t) => rec(rec(t).authenticationRef))
    .filter((r) => str(r.name))
    .map((r) => ({ name: str(r.name), kind: str(r.kind) || "TriggerAuthentication" }));
}

/**
 * How many of `users` (ScaledObjects and ScaledJobs) reference this
 * TriggerAuthentication, or with `cluster` this ClusterTriggerAuthentication.
 * A namespaced one is only reachable from its own namespace. 0 is one left
 * over from a removed ScaledObject: the KEDA page's In use column.
 */
export function authUsers(auth: Record<string, unknown>, cluster: boolean, users: Record<string, unknown>[]): number {
  const meta = rec(auth.metadata);
  const name = str(meta.name);
  const ns = str(meta.namespace);
  const kind = cluster ? "ClusterTriggerAuthentication" : "TriggerAuthentication";
  return users.filter(
    (u) => (cluster || str(rec(u.metadata).namespace) === ns) && referencedAuths(u).some((r) => r.kind === kind && r.name === name),
  ).length;
}
