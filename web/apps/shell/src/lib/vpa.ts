import type { CRDEntry } from "./api";

export interface VpaDetection {
  installed: boolean;
  vpaGvr?: string;
}

/**
 * CRD-based VPA-installed detection (same free /api/crds filter
 * detectKeda/detectKarpenter already use) — the piece the Right-sizing page
 * was missing. Without it, "no VerticalPodAutoscaler objects" and "VPA never
 * installed" were indistinguishable, so the Install prompt kept showing even
 * right after a successful `InstallVpaRecommender` install: that installs
 * the recommender *controller* only, which creates zero VPA objects on its
 * own — a real object has to be created per workload before any
 * recommendation data can exist.
 */
export function detectVpa(crds: CRDEntry[]): VpaDetection {
  const vpa = crds.find((c) => c.group === "autoscaling.k8s.io" && c.resource === "verticalpodautoscalers");
  return { installed: !!vpa, vpaGvr: vpa?.gvr };
}

/**
 * Builds a minimal VerticalPodAutoscaler manifest for one workload, always
 * `updateMode: "Off"` (observe-only — never evicts or resizes a running
 * pod). This is the other half of the install-detection fix: even once the
 * page correctly reports "VPA installed", nothing before this created an
 * actual VPA *object*, so the recommender had nothing to compute
 * recommendations from and the page would stay empty forever.
 */
export function buildVpaObjectYaml(target: { kind: string; ns: string; name: string; vpaName?: string }): string {
  const vpaName = target.vpaName || `${target.name}-vpa`;
  return `apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: ${vpaName}
  namespace: ${target.ns}
spec:
  targetRef:
    apiVersion: apps/v1
    kind: ${target.kind}
    name: ${target.name}
  updatePolicy:
    updateMode: "Off"
`;
}
