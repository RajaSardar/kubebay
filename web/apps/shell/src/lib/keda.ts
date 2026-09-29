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
  const paused = str(rec(spec.advanced).paused) === "true";

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

export interface KedaDetection {
  installed: boolean;
  scaledObjectGvr?: string;
  triggerAuthGvr?: string;
  clusterTriggerAuthGvr?: string;
}

/**
 * Fleet-wide KEDA detection (backlog: KEDA nav placement). Same free,
 * client-side /api/crds filter AutoscalingTab already uses per-workload —
 * no engine changes, no new resource kind.
 */
export function detectKeda(crds: CRDEntry[]): KedaDetection {
  const scaledObject = crds.find((c) => c.group === "keda.sh" && c.resource === "scaledobjects");
  const triggerAuth = crds.find((c) => c.group === "keda.sh" && c.resource === "triggerauthentications");
  const clusterTriggerAuth = crds.find((c) => c.group === "keda.sh" && c.resource === "clustertriggerauthentications");
  return {
    installed: !!scaledObject,
    scaledObjectGvr: scaledObject?.gvr,
    triggerAuthGvr: triggerAuth?.gvr,
    clusterTriggerAuthGvr: clusterTriggerAuth?.gvr,
  };
}

interface AuthRef {
  name: string;
  kind: string;
}

function referencedAuths(so: Record<string, unknown>): AuthRef[] {
  const trigs = rec(so.spec).triggers;
  if (!Array.isArray(trigs)) return [];
  return trigs
    .map((t) => rec(rec(t).authenticationRef))
    .filter((r) => str(r.name))
    .map((r) => ({ name: str(r.name), kind: str(r.kind) || "TriggerAuthentication" }));
}

export interface OrphanedTriggerAuth {
  name: string;
  /** Empty for a cluster-scoped ClusterTriggerAuthentication. */
  ns: string;
  /** true for a namespaced TriggerAuthentication, false for cluster-scoped. */
  scoped: boolean;
}

/**
 * A TriggerAuthentication/ClusterTriggerAuthentication no ScaledObject in
 * the cluster references at all -- the "no way to see this today" gap the
 * KEDA-nav-placement research identified: the per-workload Autoscaling tab
 * only ever looks at one workload's own ScaledObjects, so nothing anywhere
 * in the app previously cross-referenced auth objects against their users.
 */
export function findOrphanedTriggerAuths(
  scaledObjects: Record<string, unknown>[],
  triggerAuths: Record<string, unknown>[],
  clusterTriggerAuths: Record<string, unknown>[],
): OrphanedTriggerAuth[] {
  const used = new Set<string>();
  for (const so of scaledObjects) {
    const ns = str(rec(so.metadata).namespace);
    for (const ref of referencedAuths(so)) {
      const key = ref.kind === "ClusterTriggerAuthentication" ? `cluster:${ref.name}` : `ns:${ns}:${ref.name}`;
      used.add(key);
    }
  }

  const orphanedNamespaced: OrphanedTriggerAuth[] = triggerAuths
    .filter((ta) => {
      const meta = rec(ta.metadata);
      return !used.has(`ns:${str(meta.namespace)}:${str(meta.name)}`);
    })
    .map((ta) => ({ name: str(rec(ta.metadata).name), ns: str(rec(ta.metadata).namespace), scoped: true }));

  const orphanedCluster: OrphanedTriggerAuth[] = clusterTriggerAuths
    .filter((ta) => !used.has(`cluster:${str(rec(ta.metadata).name)}`))
    .map((ta) => ({ name: str(rec(ta.metadata).name), ns: "", scoped: false }));

  return [...orphanedNamespaced, ...orphanedCluster];
}
