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
