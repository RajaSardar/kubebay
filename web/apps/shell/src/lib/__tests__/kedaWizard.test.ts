import { describe, it, expect } from "vitest";
import { buildScaledObjectYaml, validateKedaWizardInput, type KedaWizardInput } from "../kedaWizard";

function baseInput(overrides: Partial<KedaWizardInput> = {}): KedaWizardInput {
  return {
    namespace: "team-a",
    targetKind: "Deployment",
    targetName: "checkout",
    scaledObjectName: "checkout-scale",
    minReplicaCount: 1,
    maxReplicaCount: 10,
    trigger: { type: "cpu", averageUtilization: 70 },
    ...overrides,
  };
}

function hpa(ns: string, targetName: string, targetKind = "Deployment") {
  return { metadata: { namespace: ns, name: `${targetName}-hpa` }, spec: { scaleTargetRef: { name: targetName, kind: targetKind } } };
}

describe("buildScaledObjectYaml", () => {
  it("generates a ScaledObject manifest with the target, replica bounds, and CPU trigger", () => {
    const yaml = buildScaledObjectYaml(baseInput());
    expect(yaml).toContain("kind: ScaledObject");
    expect(yaml).toContain("name: checkout-scale");
    expect(yaml).toContain("namespace: team-a");
    expect(yaml).toContain("name: checkout");
    expect(yaml).toContain("kind: Deployment");
    expect(yaml).toContain("minReplicaCount: 1");
    expect(yaml).toContain("maxReplicaCount: 10");
    expect(yaml).toContain("type: cpu");
    expect(yaml).toContain('value: "70"');
  });

  it("generates a prometheus trigger with server address, query, and threshold", () => {
    const yaml = buildScaledObjectYaml(
      baseInput({ trigger: { type: "prometheus", serverAddress: "http://prometheus.monitoring.svc:9090", query: "sum(rate(http_requests_total[2m]))", threshold: 100 } }),
    );
    expect(yaml).toContain("type: prometheus");
    expect(yaml).toContain('serverAddress: "http://prometheus.monitoring.svc:9090"');
    expect(yaml).toContain('query: "sum(rate(http_requests_total[2m]))"');
    expect(yaml).toContain('threshold: "100"');
  });

  it("generates a memory trigger", () => {
    const yaml = buildScaledObjectYaml(baseInput({ trigger: { type: "memory", averageUtilization: 80 } }));
    expect(yaml).toContain("type: memory");
    expect(yaml).toContain('value: "80"');
  });

  it("generates a cron trigger with schedule, timezone, and desired replicas", () => {
    const yaml = buildScaledObjectYaml(
      baseInput({ trigger: { type: "cron", start: "0 9 * * 1-5", end: "0 18 * * 1-5", timezone: "America/New_York", desiredReplicas: 5 } }),
    );
    expect(yaml).toContain("type: cron");
    expect(yaml).toContain('start: "0 9 * * 1-5"');
    expect(yaml).toContain('end: "0 18 * * 1-5"');
    expect(yaml).toContain('timezone: "America/New_York"');
    expect(yaml).toContain('desiredReplicas: "5"');
  });

  it("always ships paused, per the backlog's what-if-mode safety rule", () => {
    const yaml = buildScaledObjectYaml(baseInput());
    expect(yaml).toContain('paused: "true"');
  });
});

describe("validateKedaWizardInput", () => {
  it("passes for a valid, non-conflicting input", () => {
    expect(validateKedaWizardInput(baseInput(), [])).toEqual([]);
  });

  it("requires a ScaledObject name", () => {
    const errors = validateKedaWizardInput(baseInput({ scaledObjectName: "  " }), []);
    expect(errors.some((e) => /name/i.test(e))).toBe(true);
  });

  it("rejects maxReplicaCount below minReplicaCount", () => {
    const errors = validateKedaWizardInput(baseInput({ minReplicaCount: 5, maxReplicaCount: 2 }), []);
    expect(errors.some((e) => /max/i.test(e))).toBe(true);
  });

  it("blocks (not just warns) when an HPA already targets the same workload", () => {
    const errors = validateKedaWizardInput(baseInput(), [hpa("team-a", "checkout")]);
    expect(errors.some((e) => /HPA/i.test(e))).toBe(true);
  });

  it("does not block on an HPA targeting a different workload", () => {
    const errors = validateKedaWizardInput(baseInput(), [hpa("team-a", "other-service")]);
    expect(errors).toEqual([]);
  });

  it("requires both a start and end schedule for a cron trigger", () => {
    const errors = validateKedaWizardInput(baseInput({ trigger: { type: "cron", start: "", end: "", timezone: "UTC", desiredReplicas: 3 } }), []);
    expect(errors.some((e) => /cron/i.test(e))).toBe(true);
  });

  it("requires a positive utilization for cpu/memory triggers", () => {
    const errors = validateKedaWizardInput(baseInput({ trigger: { type: "cpu", averageUtilization: 0 } }), []);
    expect(errors.some((e) => /utilization/i.test(e))).toBe(true);
  });

  it("requires a server address, query, and positive threshold for a prometheus trigger", () => {
    const errors = validateKedaWizardInput(
      baseInput({ trigger: { type: "prometheus", serverAddress: "", query: "", threshold: 0 } }),
      [],
    );
    expect(errors.some((e) => /server address/i.test(e))).toBe(true);
    expect(errors.some((e) => /query/i.test(e))).toBe(true);
    expect(errors.some((e) => /threshold/i.test(e))).toBe(true);
  });

  it("passes for a complete prometheus trigger", () => {
    const errors = validateKedaWizardInput(
      baseInput({ trigger: { type: "prometheus", serverAddress: "http://prometheus.monitoring.svc:9090", query: "up", threshold: 1 } }),
      [],
    );
    expect(errors).toEqual([]);
  });
});
