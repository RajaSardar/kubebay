import { hpaConflictsWithScaledObject } from "./keda";

export interface CronTrigger {
  type: "cron";
  start: string;
  end: string;
  timezone: string;
  desiredReplicas: number;
}

export interface UtilizationTrigger {
  type: "cpu" | "memory";
  averageUtilization: number;
}

export interface PrometheusTrigger {
  type: "prometheus";
  /** In-cluster address KEDA itself resolves — never Kubebay's local Prometheus proxy URL. */
  serverAddress: string;
  query: string;
  threshold: number;
}

export type KedaTrigger = CronTrigger | UtilizationTrigger | PrometheusTrigger;

export interface KedaWizardInput {
  namespace: string;
  targetKind: "Deployment" | "StatefulSet";
  targetName: string;
  scaledObjectName: string;
  minReplicaCount: number;
  maxReplicaCount: number;
  trigger: KedaTrigger;
}

function yamlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Backlog #2 P3 wizard, cron + CPU/memory only: generates a ScaledObject
 * manifest from a handful of known, controlled fields — a hand-rolled
 * template rather than a YAML serializer, since every value here is a
 * simple string/number under our control, not arbitrary user content.
 * Always ships `advanced.paused: "true"` per the backlog's safety rule: the
 * first apply reconciles and reports desired metrics without acting, and
 * unpausing is a deliberate, separate action.
 */
function triggerYamlFor(trigger: KedaTrigger): string {
  if (trigger.type === "cron") {
    return `  - type: cron
    metadata:
      timezone: ${yamlString(trigger.timezone || "UTC")}
      start: ${yamlString(trigger.start)}
      end: ${yamlString(trigger.end)}
      desiredReplicas: ${yamlString(String(trigger.desiredReplicas))}`;
  }
  if (trigger.type === "prometheus") {
    return `  - type: prometheus
    metadata:
      serverAddress: ${yamlString(trigger.serverAddress)}
      query: ${yamlString(trigger.query)}
      threshold: ${yamlString(String(trigger.threshold))}`;
  }
  return `  - type: ${trigger.type}
    metadata:
      type: Utilization
      value: ${yamlString(String(trigger.averageUtilization))}`;
}

export function buildScaledObjectYaml(input: KedaWizardInput): string {
  const triggerYaml = triggerYamlFor(input.trigger);

  return `apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: ${input.scaledObjectName}
  namespace: ${input.namespace}
spec:
  scaleTargetRef:
    name: ${input.targetName}
    kind: ${input.targetKind}
  minReplicaCount: ${input.minReplicaCount}
  maxReplicaCount: ${input.maxReplicaCount}
  advanced:
    paused: "true"
  triggers:
${triggerYaml}
`;
}

/**
 * Blocking (not warning) validation, per the backlog's safety rules: an
 * existing HPA on the same target is a hard stop, not a caveat, since dual
 * ownership causes replica flapping in practice.
 */
export function validateKedaWizardInput(input: KedaWizardInput, existingHpas: Record<string, unknown>[]): string[] {
  const errors: string[] = [];

  if (input.scaledObjectName.trim() === "") errors.push("ScaledObject name is required.");
  if (input.targetName.trim() === "") errors.push("Target workload name is required.");
  if (input.minReplicaCount < 0) errors.push("minReplicaCount cannot be negative.");
  if (input.maxReplicaCount < input.minReplicaCount) errors.push("maxReplicaCount must be greater than or equal to minReplicaCount.");

  const fakeScaledObject = { spec: { scaleTargetRef: { name: input.targetName, kind: input.targetKind } } };
  if (hpaConflictsWithScaledObject(fakeScaledObject, existingHpas)) {
    errors.push(
      `An HPA already targets ${input.targetKind.toLowerCase()} "${input.targetName}" — remove it before adding a ScaledObject (dual ownership causes replica flapping).`,
    );
  }

  if (input.trigger.type === "cron") {
    if (!input.trigger.start.trim() || !input.trigger.end.trim()) {
      errors.push("Cron trigger needs both a start and end schedule.");
    }
  } else if (input.trigger.type === "prometheus") {
    if (!input.trigger.serverAddress.trim()) errors.push("Prometheus server address is required.");
    if (!input.trigger.query.trim()) errors.push("Prometheus query is required.");
    if (input.trigger.threshold <= 0) errors.push("Threshold must be greater than 0.");
  } else if (input.trigger.averageUtilization <= 0) {
    errors.push("Target utilization must be greater than 0.");
  }

  return errors;
}
