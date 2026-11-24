import { describe, expect, it } from "vitest";
import { computeIssues, type IssueInputs } from "../issues";

type Obj = Record<string, unknown>;
const NOW = Date.parse("2026-10-02T12:00:00Z");

// A large cluster with about 14% broken pods. The page recomputes this on
// stream flushes, so one pass has to stay cheap.
function cluster(PODS: number): IssueInputs {
  const WORKLOADS = Math.ceil(PODS / 4);
  const NS = 100;
  const created = new Date(NOW - 3_600_000).toISOString();
  const pods: Obj[] = Array.from({ length: PODS }, (_, i) => {
    const w = i % WORKLOADS;
    const broken = i % 7 === 0;
    return {
      metadata: {
        name: `app-${w}-${i}`,
        namespace: `ns${w % NS}`,
        creationTimestamp: created,
        labels: { app: `app-${w}`, "pod-template-hash": "h" },
        ownerReferences: [{ kind: "ReplicaSet", name: `app-${w}-h`, controller: true }],
      },
      spec: { nodeName: `node-${i % 50}`, containers: [{ name: "c", image: "nginx:1.25" }] },
      status: {
        phase: "Running",
        containerStatuses: [
          { name: "c", ready: !broken, restartCount: broken ? 5 : 0, state: broken ? { waiting: { reason: "CrashLoopBackOff" } } : { running: {} } },
        ],
      },
    };
  });
  const deployments: Obj[] = Array.from({ length: WORKLOADS }, (_, w) => ({
    metadata: { name: `app-${w}`, namespace: `ns${w % NS}` },
    spec: { replicas: 4, selector: { matchLabels: { app: `app-${w}` } }, template: { metadata: { labels: { app: `app-${w}` } }, spec: { containers: [{ name: "c", image: "nginx:1.25" }] } } },
    status: { readyReplicas: 3, replicas: 4 },
  }));
  const services: Obj[] = Array.from({ length: WORKLOADS }, (_, w) => ({
    metadata: { name: `app-${w}`, namespace: `ns${w % NS}` },
    spec: { type: "ClusterIP", selector: { app: `app-${w}` } },
  }));
  const endpointSlices: Obj[] = services.map((s) => ({
    metadata: { name: `${(s.metadata as Obj).name}-x`, namespace: (s.metadata as Obj).namespace, labels: { "kubernetes.io/service-name": (s.metadata as Obj).name } },
    endpoints: [{ addresses: ["10.0.0.1"], conditions: { ready: true } }],
  }));
  const nodes: Obj[] = Array.from({ length: 50 }, (_, i) => ({
    metadata: { name: `node-${i}` },
    status: { conditions: [{ type: "Ready", status: i === 0 ? "False" : "True" }] },
  }));
  const namespaces: Obj[] = Array.from({ length: NS }, (_, i) => ({ metadata: { name: `ns${i}` } }));
  return {
    pods,
    deployments,
    statefulsets: [],
    daemonsets: [],
    nodes,
    services,
    endpointSlices,
    certificates: [],
    pdbs: [],
    networkPolicies: [],
    bestPractices: { deployments, statefulsets: [], pdbs: [], networkPolicies: [], namespaces, ingressClasses: [], apiGroups: [], services, nodes, pods },
    upgrade: { serverVersion: "v1.30.1", served: ["apps/v1"] },
    now: NOW,
  };
}

function time(input: IssueInputs): number {
  const t = performance.now();
  computeIssues("big", input);
  return performance.now() - t;
}

describe("computeIssues at scale", () => {
  it("handles 2,000 pods quickly and finds the broken ones", () => {
    const input = cluster(2000);
    computeIssues("big", input); // warm-up
    const r = computeIssues("big", input);
    expect(r.issues.filter((i) => i.detector === "pod-problem").length).toBeGreaterThan(100);
    expect(r.issues[0]!.severity).toBe("critical");
    const best = Math.min(time(input), time(input), time(input));
    expect(best).toBeLessThan(1500);
  });

  it("grows roughly linearly: 4,000 pods cost well under 4x of 2,000", () => {
    const small = cluster(2000);
    const big = cluster(4000);
    computeIssues("big", small);
    computeIssues("big", big);
    const a = Math.max(Math.min(time(small), time(small), time(small)), 1);
    const b = Math.min(time(big), time(big), time(big));
    expect(b / a).toBeLessThan(4);
  });
});
