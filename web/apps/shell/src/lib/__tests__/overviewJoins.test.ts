import { describe, expect, it } from "vitest";
import { computeSpofFindings } from "../spof";
import { findServiceSelectorMismatches } from "../serviceSelectorMismatch";
import { findAttention } from "../attention";
import { podStatusSegments } from "../podStatusBar";
import { aggregatePressure } from "../pressure";
import { clusterCapacity } from "../capacity";
import { rankNamespaces } from "../namespaceRanking";
import { computeKindCounts } from "../kindCounts";
import { checkCoreDns } from "../coreDnsHealth";
import { replicaSetOwners, ownerCellOf } from "../ownerColumn";

// Perf pass 3: Workloads and WorkloadsOverview join several streams on every
// flush. At 2,000 pods, 500 ReplicaSets, 500 Deployments, 500 Services and 500
// EndpointSlices, every join must read each object a bounded number of times:
// a `.filter` over all pods inside a loop over workloads reads each pod 500
// times. Counts property reads through a Proxy, not time.

type Obj = Record<string, unknown>;
const NS = 50;
const DEPLOYMENTS = 500;

function counted(objs: Obj[]): { objs: Obj[]; reads: () => number; reset: () => void } {
  let n = 0;
  const wrapped = objs.map(
    (o) =>
      new Proxy(o, {
        get(t, k, r) {
          n++;
          return Reflect.get(t, k, r);
        },
      }),
  );
  return { objs: wrapped, reads: () => n, reset: () => (n = 0) };
}

const created = "2026-11-01T00:00:00Z";

function fixture() {
  const deployments: Obj[] = [];
  const replicaSets: Obj[] = [];
  const pods: Obj[] = [];
  const services: Obj[] = [];
  const slices: Obj[] = [];
  const pdbs: Obj[] = [];
  for (let d = 0; d < DEPLOYMENTS; d++) {
    const ns = `ns-${d % NS}`;
    const name = `app-${d}`;
    // Even ones run 7 replicas on one node with no spread (a SPOF finding);
    // odd ones a single replica, every fourth covered by a PDB.
    const replicas = d % 2 === 0 ? 7 : 1;
    deployments.push({
      metadata: { name, namespace: ns },
      spec: { replicas, template: { metadata: { labels: { app: name, tier: "web" } }, spec: {} } },
      status: { readyReplicas: replicas, conditions: [{ type: "Available", status: "True" }] },
    });
    replicaSets.push({
      metadata: { name: `${name}-h${d}`, namespace: ns, ownerReferences: [{ apiVersion: "apps/v1", kind: "Deployment", name, controller: true }] },
    });
    for (let i = 0; i < replicas; i++) {
      pods.push({
        metadata: {
          name: `${name}-h${d}-${i}`,
          namespace: ns,
          creationTimestamp: created,
          resourceVersion: "1",
          labels: { app: name, tier: "web", "pod-template-hash": `h${d}` },
          ownerReferences: [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: `${name}-h${d}`, controller: true }],
        },
        spec: { nodeName: `node-${d % 20}`, containers: [{ name: "app", resources: { requests: { cpu: "100m", memory: "64Mi" } } }] },
        status: {
          phase: d % 10 === 0 ? "Pending" : "Running",
          containerStatuses: [{ name: "app", ready: d % 10 !== 0, restartCount: 0, state: d % 10 === 0 ? { waiting: { reason: "CrashLoopBackOff" } } : { running: {} } }],
        },
      });
    }
    services.push({ metadata: { name, namespace: ns }, spec: { selector: { app: name } } });
    slices.push({
      metadata: { name: `${name}-x`, namespace: ns, labels: { "kubernetes.io/service-name": name } },
      endpoints: [{ addresses: ["10.0.0.1"], conditions: { ready: d % 3 !== 0 } }],
    });
    if (d % 4 === 1) pdbs.push({ metadata: { name: `${name}-pdb`, namespace: ns }, spec: { selector: { matchLabels: { app: name } } } });
  }
  const nodes: Obj[] = Array.from({ length: 20 }, (_, i) => ({
    metadata: { name: `node-${i}` },
    status: { conditions: [{ type: "Ready", status: "True" }], allocatable: { cpu: "8", memory: "32Gi" } },
  }));
  return { deployments, replicaSets, pods, services, slices, pdbs, nodes };
}

describe("Overview stream joins at 2,000 pods / 500 ReplicaSets", () => {
  const f = fixture();
  it("builds the fixture at the stated scale", () => {
    expect(f.pods.length).toBe(2000);
    expect(f.replicaSets.length).toBe(500);
  });

  // Each join may read each object a few times (metadata, spec, status), not once per other object.
  const PER_OBJECT = 20;

  it("SPOF Radar reads each pod, PDB and EndpointSlice a bounded number of times", () => {
    const pods = counted(f.pods);
    const pdbs = counted(f.pdbs);
    const slices = counted(f.slices);
    const findings = computeSpofFindings({
      deployments: f.deployments,
      statefulSets: [],
      pdbs: pdbs.objs,
      pods: pods.objs,
      services: f.services,
      endpointSlices: slices.objs,
    });
    expect(findings.filter((x) => x.kind === "no-spread")).toHaveLength(250);
    expect(findings.filter((x) => x.kind === "no-pdb")).toHaveLength(125);
    expect(pods.reads()).toBeLessThanOrEqual(PER_OBJECT * f.pods.length);
    expect(pdbs.reads()).toBeLessThanOrEqual(PER_OBJECT * f.pdbs.length);
    expect(slices.reads()).toBeLessThanOrEqual(PER_OBJECT * f.slices.length);
  });

  it("Service Health's selector check reads each pod and EndpointSlice a bounded number of times", () => {
    const pods = counted(f.pods);
    const slices = counted(f.slices);
    const out = findServiceSelectorMismatches(f.services, pods.objs, slices.objs);
    // Every third Service's only backend is not ready.
    expect(out.filter((x) => x.reason === "zero-ready-endpoints")).toHaveLength(167);
    expect(pods.reads()).toBeLessThanOrEqual(PER_OBJECT * f.pods.length);
    expect(slices.reads()).toBeLessThanOrEqual(PER_OBJECT * f.slices.length);
  });

  it("the Overview tab's joins read each pod a bounded number of times", () => {
    const pods = counted(f.pods);
    const deps = counted(f.deployments);
    const rows = findAttention({ pods: pods.objs, deployments: deps.objs, statefulSets: [], daemonSets: [], nodes: f.nodes, now: Date.parse(created) + 3_600_000 });
    expect(rows.length).toBeGreaterThan(0);
    podStatusSegments(pods.objs);
    aggregatePressure(pods.objs, f.nodes, []);
    clusterCapacity({ pods: pods.objs, nodes: f.nodes });
    rankNamespaces({ pods: pods.objs, attention: rows, events: [], by: "problems" });
    computeKindCounts({ pods: pods.objs, nodes: f.nodes, deployments: deps.objs, statefulsets: [], daemonsets: [], jobs: [] });
    checkCoreDns(deps.objs, pods.objs, []);
    // Seven joins over the same pods.
    expect(pods.reads()).toBeLessThanOrEqual(7 * PER_OBJECT * f.pods.length);
    expect(deps.reads()).toBeLessThanOrEqual(3 * PER_OBJECT * f.deployments.length);
  });

  it("Workloads' Owner column reads each ReplicaSet once per stream change, not once per pod", () => {
    const rss = counted(f.replicaSets);
    const owners = replicaSetOwners(rss.objs);
    const built = rss.reads();
    for (const p of f.pods) ownerCellOf(p, owners);
    expect(rss.reads()).toBe(built);
    expect(built).toBeLessThanOrEqual(PER_OBJECT * f.replicaSets.length);
    expect(ownerCellOf(f.pods[0], owners).text).toBe("Deployment/app-0");
  });
});
