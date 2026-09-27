import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AutoscalingSummary } from "../AutoscalingTab";

function scaledObject(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "app-so", namespace: "default" },
    spec: {
      scaleTargetRef: { name: "app", kind: "Deployment" },
      minReplicaCount: 1,
      maxReplicaCount: 20,
      triggers: [{ type: "cpu", metadata: { value: "50" } }],
    },
    status: { currentReplicas: 3 },
    ...overrides,
  };
}

function hpa(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "app-hpa", namespace: "default" },
    spec: { scaleTargetRef: { name: "app", kind: "Deployment" }, minReplicas: 2, maxReplicas: 8 },
    status: { currentReplicas: 4 },
    ...overrides,
  };
}

function vpa(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "app-vpa", namespace: "default" },
    spec: { targetRef: { name: "app", kind: "Deployment" }, updatePolicy: { updateMode: "Off" } },
    ...overrides,
  };
}

describe("AutoscalingSummary", () => {
  it("shows a 'no autoscalers' empty state when nothing targets this workload", () => {
    render(<AutoscalingSummary scaledObjects={[]} hpas={[]} vpas={[]} />);
    expect(screen.getByText(/no autoscaler/i)).toBeTruthy();
  });

  it("shows a Managed by KEDA badge and the plain-English explanation for a ScaledObject", () => {
    render(<AutoscalingSummary scaledObjects={[scaledObject()]} hpas={[]} vpas={[]} />);
    expect(screen.getByText(/managed by keda/i)).toBeTruthy();
    expect(screen.getByText(/1→20/)).toBeTruthy();
  });

  it("flags minReplicaCount: 0 with a visible warning", () => {
    const so = scaledObject({ spec: { scaleTargetRef: { name: "app", kind: "Deployment" }, minReplicaCount: 0, maxReplicaCount: 10, triggers: [] } });
    render(<AutoscalingSummary scaledObjects={[so]} hpas={[]} vpas={[]} />);
    expect(screen.getByText(/scale.to.zero/i)).toBeTruthy();
  });

  it("flags an HPA/ScaledObject conflict targeting the same workload", () => {
    render(<AutoscalingSummary scaledObjects={[scaledObject()]} hpas={[hpa()]} vpas={[]} />);
    expect(screen.getByText(/conflict/i)).toBeTruthy();
  });

  it("lists an HPA's min/max/current even with no ScaledObject present", () => {
    render(<AutoscalingSummary scaledObjects={[]} hpas={[hpa()]} vpas={[]} />);
    expect(screen.queryByText(/managed by keda/i)).toBeNull();
    expect(screen.getByText(/2.*8/)).toBeTruthy();
  });

  it("lists a VPA's update mode", () => {
    render(<AutoscalingSummary scaledObjects={[]} hpas={[]} vpas={[vpa()]} />);
    expect(screen.getByText(/Off/)).toBeTruthy();
  });
});
