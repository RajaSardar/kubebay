import { describe, it, expect } from "vitest";
import { detectVpa, buildVpaObjectYaml } from "../vpa";
import type { CRDEntry } from "../api";

function crd(group: string, resource: string, gvr: string): CRDEntry {
  return { name: `${resource}.${group}`, group, version: "v1", resource, kind: resource, namespaced: true, gvr, columns: [] };
}

describe("detectVpa", () => {
  it("reports not installed when no autoscaling.k8s.io CRDs are discovered", () => {
    expect(detectVpa([]).installed).toBe(false);
  });

  it("detects the VerticalPodAutoscaler CRD and reports installed", () => {
    const crds = [crd("autoscaling.k8s.io", "verticalpodautoscalers", "autoscaling.k8s.io/v1/verticalpodautoscalers")];
    const d = detectVpa(crds);
    expect(d.installed).toBe(true);
    expect(d.vpaGvr).toBe("autoscaling.k8s.io/v1/verticalpodautoscalers");
  });

  it("does not report installed from an unrelated CRD in a different group", () => {
    const crds = [crd("keda.sh", "scaledobjects", "keda.sh/v1alpha1/scaledobjects")];
    expect(detectVpa(crds).installed).toBe(false);
  });
});

describe("buildVpaObjectYaml", () => {
  it("builds a VerticalPodAutoscaler manifest targeting the workload in updateMode Off", () => {
    const yaml = buildVpaObjectYaml({ kind: "Deployment", ns: "prod", name: "web" });
    expect(yaml).toContain("apiVersion: autoscaling.k8s.io/v1");
    expect(yaml).toContain("kind: VerticalPodAutoscaler");
    expect(yaml).toContain("name: web-vpa");
    expect(yaml).toContain("namespace: prod");
    expect(yaml).toContain("kind: Deployment");
    expect(yaml).toContain("name: web");
    expect(yaml).toContain('updateMode: "Off"');
  });

  it("uses an explicit vpaName when given instead of deriving one", () => {
    const yaml = buildVpaObjectYaml({ kind: "StatefulSet", ns: "prod", name: "db", vpaName: "custom-vpa" });
    expect(yaml).toContain("name: custom-vpa");
  });
});
