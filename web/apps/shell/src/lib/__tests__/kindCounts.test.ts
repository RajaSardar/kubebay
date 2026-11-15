import { describe, it, expect } from "vitest";
import { computeKindCounts, type KindCountsInput } from "../kindCounts";

function empty(): KindCountsInput {
  return { pods: [], nodes: [], deployments: [], statefulsets: [], daemonsets: [], jobs: [] };
}

function pod(phase: string) {
  return { status: { phase } };
}

function workload(desired: number, ready: number) {
  return { spec: { replicas: desired }, status: { readyReplicas: ready } };
}

function job(failed: number) {
  return { status: { failed } };
}

function node(ready: boolean) {
  return { status: { conditions: [{ type: "Ready", status: ready ? "True" : "False" }] } };
}

describe("computeKindCounts", () => {
  it("counts Running and Succeeded pods as healthy, everything else as unhealthy", () => {
    const input = { ...empty(), pods: [pod("Running"), pod("Succeeded"), pod("Pending"), pod("Failed"), pod("CrashLoopBackOff")] };
    const pods = computeKindCounts(input).find((k) => k.label === "Pods")!;
    expect(pods).toEqual({ label: "Pods", to: "/workloads", total: 5, healthy: 2, unhealthy: 3 });
  });

  it("counts a Deployment/StatefulSet/DaemonSet as healthy only when readyReplicas >= desired and desired > 0", () => {
    const input = { ...empty(), deployments: [workload(3, 3), workload(3, 1), workload(0, 0)] };
    const deps = computeKindCounts(input).find((k) => k.label === "Deployments")!;
    // desired=3/ready=3 -> healthy; desired=3/ready=1 -> unhealthy; desired=0/ready=0 -> unhealthy (desired must be > 0)
    expect(deps).toEqual({ label: "Deployments", to: "/r/deployments", total: 3, healthy: 1, unhealthy: 2 });
  });

  it("counts a Job with any failed pod as unhealthy", () => {
    const input = { ...empty(), jobs: [job(0), job(1), job(2)] };
    const jobs = computeKindCounts(input).find((k) => k.label === "Jobs")!;
    expect(jobs).toEqual({ label: "Jobs", to: "/r/jobs", total: 3, healthy: 1, unhealthy: 2 });
  });

  it("counts a Node as healthy only when its Ready condition is True", () => {
    const input = { ...empty(), nodes: [node(true), node(true), node(false)] };
    const nodes = computeKindCounts(input).find((k) => k.label === "Nodes")!;
    expect(nodes).toEqual({ label: "Nodes", to: "/r/nodes", total: 3, healthy: 2, unhealthy: 1 });
  });

  it("returns all five kinds even when every stream is empty", () => {
    const labels = computeKindCounts(empty()).map((k) => k.label);
    expect(labels).toEqual(["Pods", "Deployments", "StatefulSets", "DaemonSets", "Jobs", "Nodes"]);
  });
});
