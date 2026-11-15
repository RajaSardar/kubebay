// Backlog #25: Upgrade Readiness Panel.
//
// Table sourced from the official Kubernetes API deprecation guide
// (kubernetes.io/docs/reference/using-api/deprecation-guide/). Best-effort,
// not exhaustive -- covers the removals most likely to actually bite a
// real cluster (PDB/CronJob/HPA/EndpointSlice at 1.25, Ingress/CRD/webhook
// configs at 1.22). Worth widening once this ships and gets real use.
export interface DeprecatedApi {
  kind: string;
  group: string;
  version: string;
  removedInMinor: number;
  replacementVersion: string;
}

export const DEPRECATED_APIS: DeprecatedApi[] = [
  { kind: "Ingress", group: "extensions", version: "v1beta1", removedInMinor: 22, replacementVersion: "networking.k8s.io/v1" },
  { kind: "Ingress", group: "networking.k8s.io", version: "v1beta1", removedInMinor: 22, replacementVersion: "networking.k8s.io/v1" },
  { kind: "CustomResourceDefinition", group: "apiextensions.k8s.io", version: "v1beta1", removedInMinor: 22, replacementVersion: "apiextensions.k8s.io/v1" },
  { kind: "MutatingWebhookConfiguration", group: "admissionregistration.k8s.io", version: "v1beta1", removedInMinor: 22, replacementVersion: "admissionregistration.k8s.io/v1" },
  { kind: "ValidatingWebhookConfiguration", group: "admissionregistration.k8s.io", version: "v1beta1", removedInMinor: 22, replacementVersion: "admissionregistration.k8s.io/v1" },
  { kind: "PodDisruptionBudget", group: "policy", version: "v1beta1", removedInMinor: 25, replacementVersion: "policy/v1" },
  { kind: "CronJob", group: "batch", version: "v1beta1", removedInMinor: 25, replacementVersion: "batch/v1" },
  { kind: "HorizontalPodAutoscaler", group: "autoscaling", version: "v2beta1", removedInMinor: 25, replacementVersion: "autoscaling/v2" },
  { kind: "EndpointSlice", group: "discovery.k8s.io", version: "v1beta1", removedInMinor: 25, replacementVersion: "discovery.k8s.io/v1" },
  { kind: "HorizontalPodAutoscaler", group: "autoscaling", version: "v2beta2", removedInMinor: 26, replacementVersion: "autoscaling/v2" },
  { kind: "FlowSchema", group: "flowcontrol.apiserver.k8s.io", version: "v1beta1", removedInMinor: 29, replacementVersion: "flowcontrol.apiserver.k8s.io/v1" },
  { kind: "PriorityLevelConfiguration", group: "flowcontrol.apiserver.k8s.io", version: "v1beta1", removedInMinor: 29, replacementVersion: "flowcontrol.apiserver.k8s.io/v1" },
];

// How many minor releases out a removal still counts as "within reach" of
// the connected server version -- matches the roadmap's own framing
// ("within 1-2 minor releases").
const HORIZON_MINORS = 2;

export function parseServerMinor(gitVersion: string): number | undefined {
  const m = /^v?\d+\.(\d+)/.exec(gitVersion.trim());
  return m?.[1] ? parseInt(m[1], 10) : undefined;
}

export interface UpgradeReadinessFinding {
  kind: string;
  apiVersion: string;
  replacementVersion: string;
  removedInMinor: number;
  minorsAway: number;
}

export function computeUpgradeReadiness(serverVersion: string, servedGroupVersions: string[]): UpgradeReadinessFinding[] {
  const minor = parseServerMinor(serverVersion);
  if (minor === undefined) return [];

  const served = new Set(servedGroupVersions);
  const findings: UpgradeReadinessFinding[] = [];
  for (const api of DEPRECATED_APIS) {
    const apiVersion = `${api.group}/${api.version}`;
    if (!served.has(apiVersion)) continue;
    const minorsAway = api.removedInMinor - minor;
    if (minorsAway > HORIZON_MINORS) continue;
    findings.push({ kind: api.kind, apiVersion, replacementVersion: api.replacementVersion, removedInMinor: api.removedInMinor, minorsAway });
  }
  return findings.sort((a, b) => a.minorsAway - b.minorsAway);
}
