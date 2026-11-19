import type { CRDEntry } from "./api";

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export interface ArgoEventsDetection {
  installed: boolean;
  eventSourceGvr?: string;
  sensorGvr?: string;
  eventBusGvr?: string;
}

/** By resource name inside argoproj.io (shared with Argo CD, Workflows and Rollouts). */
export function detectArgoEvents(crds: CRDEntry[]): ArgoEventsDetection {
  const find = (resource: string) => crds.find((c) => c.group === "argoproj.io" && c.resource === resource)?.gvr;
  const eventSourceGvr = find("eventsources");
  const sensorGvr = find("sensors");
  const eventBusGvr = find("eventbus");
  return { installed: !!(eventSourceGvr || sensorGvr || eventBusGvr), eventSourceGvr, sensorGvr, eventBusGvr };
}

export interface ConditionState {
  state: "Ready" | "Not ready" | "Unknown";
  message: string;
  conditions: { type: string; ok: boolean }[];
}

/**
 * Argo Events objects report several conditions (Deployed, SourcesProvided,
 * TriggersProvided, Configured...) rather than one Ready. Ready means all of
 * them are True; any False is Not ready, with that condition's message.
 */
export function conditionState(obj: Record<string, unknown>): ConditionState {
  const list = arr(rec(obj.status).conditions).map(rec);
  const conditions = list.map((c) => ({ type: str(c.type), ok: str(c.status) === "True" }));
  const failed = list.find((c) => str(c.status) === "False");
  if (failed) return { state: "Not ready", message: str(failed.message), conditions };
  if (list.length > 0 && list.every((c) => str(c.status) === "True")) return { state: "Ready", message: "", conditions };
  return { state: "Unknown", message: "", conditions };
}

// EventSourceSpec keys that configure the pod, not an event source.
const NOT_A_SOURCE = new Set(["template", "service", "eventBusName", "replicas", "type", "filter"]);

export interface EventSourceSummary extends ConditionState {
  name: string;
  ns: string;
  bus: string;
  events: { type: string; name: string }[];
  types: string[];
}

/**
 * Event types an EventSource declares: each spec key that is a map of named
 * event configs (webhook, calendar, github, kafka, ...) other than the keys
 * that configure the pod.
 */
export function summarizeEventSource(es: Record<string, unknown>): EventSourceSummary {
  const meta = rec(es.metadata);
  const spec = rec(es.spec);
  const events: { type: string; name: string }[] = [];
  for (const [type, v] of Object.entries(spec)) {
    if (NOT_A_SOURCE.has(type)) continue;
    const named = rec(v);
    const entries = Object.entries(named);
    if (entries.length === 0 || !entries.every(([, c]) => c && typeof c === "object" && !Array.isArray(c))) continue;
    for (const [name] of entries) events.push({ type, name });
  }
  return {
    ...conditionState(es),
    name: str(meta.name),
    ns: str(meta.namespace),
    bus: str(spec.eventBusName) || "default",
    events,
    types: [...new Set(events.map((e) => e.type))],
  };
}

// Keys of a trigger template that are not the trigger itself.
const NOT_A_TRIGGER = new Set(["name", "conditions", "conditionsReset", "retryStrategy", "rateLimit", "policy", "atLeastOnce", "parameters", "dlqTrigger"]);

export interface SensorTrigger {
  name: string;
  type: string;
  operation: string;
  targetKind: string;
  targetName: string;
  targetNs: string;
  isWorkflow: boolean;
}

export interface SensorSummary extends ConditionState {
  name: string;
  ns: string;
  bus: string;
  dependencies: { name: string; eventSource: string; event: string }[];
  triggers: SensorTrigger[];
}

function summarizeTrigger(t: unknown): SensorTrigger {
  const tpl = rec(rec(t).template);
  const type = Object.keys(tpl).find((k) => !NOT_A_TRIGGER.has(k) && tpl[k] && typeof tpl[k] === "object") ?? "";
  const body = rec(tpl[type]);
  const resource = rec(rec(body.source).resource);
  const rmeta = rec(resource.metadata);
  let targetKind = "";
  if (type === "argoWorkflow") targetKind = str(resource.kind) || "Workflow";
  else if (type === "k8s") targetKind = str(resource.kind);
  const targetName = targetKind ? str(rmeta.name) || (str(rmeta.generateName) ? `${str(rmeta.generateName)}*` : "") : "";
  return {
    name: str(tpl.name),
    type,
    operation: str(body.operation),
    targetKind,
    targetName,
    targetNs: targetKind ? str(rmeta.namespace) : "",
    isWorkflow: targetKind === "Workflow",
  };
}

/** A Sensor's dependencies (eventSource/event) and what each trigger creates. */
export function summarizeSensor(s: Record<string, unknown>): SensorSummary {
  const meta = rec(s.metadata);
  const spec = rec(s.spec);
  return {
    ...conditionState(s),
    name: str(meta.name),
    ns: str(meta.namespace),
    bus: str(spec.eventBusName) || "default",
    dependencies: arr(spec.dependencies).map((d) => ({
      name: str(rec(d).name),
      eventSource: str(rec(d).eventSourceName),
      event: str(rec(d).eventName),
    })),
    triggers: arr(spec.triggers).map(summarizeTrigger),
  };
}

export interface EventBusSummary extends ConditionState {
  name: string;
  ns: string;
  backend: string;
  replicas: number | null;
}

function replicasOf(v: unknown): number | null {
  const r = rec(v).replicas;
  return typeof r === "number" ? r : null;
}

export function summarizeEventBus(b: Record<string, unknown>): EventBusSummary {
  const meta = rec(b.metadata);
  const spec = rec(b.spec);
  let backend = "unknown";
  let replicas: number | null = null;
  if (spec.jetstream) {
    backend = "jetstream";
    replicas = replicasOf(spec.jetstream);
  } else if (spec.nats) {
    const nats = rec(spec.nats);
    if (nats.exotic) backend = "nats (external)";
    else {
      backend = "nats";
      replicas = replicasOf(nats.native);
    }
  } else if (spec.kafka) {
    backend = "kafka";
  }
  return { ...conditionState(b), name: str(meta.name), ns: str(meta.namespace), backend, replicas };
}
