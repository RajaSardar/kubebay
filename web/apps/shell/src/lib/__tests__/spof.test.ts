import { describe, it, expect } from "vitest";
import { findSingleReplicaNoPdb, findClusteredReplicas, findSingleReadyBackend, computeSpofFindings } from "../spof";

function workload(kind: string, ns: string, name: string, replicas: number, labels: Record<string, string>, opts: { topologySpread?: boolean; antiAffinity?: boolean } = {}) {
  const podSpec: Record<string, unknown> = {};
  if (opts.topologySpread) podSpec.topologySpreadConstraints = [{ maxSkew: 1, topologyKey: "kubernetes.io/hostname" }];
  if (opts.antiAffinity) {
    podSpec.affinity = { podAntiAffinity: { requiredDuringSchedulingIgnoredDuringExecution: [{}] } };
  }
  return {
    kind,
    obj: {
      metadata: { namespace: ns, name },
      spec: { replicas, template: { metadata: { labels }, spec: podSpec } },
    },
  };
}

function pdb(ns: string, matchLabels: Record<string, string>) {
  return { metadata: { namespace: ns, name: "pdb" }, spec: { selector: { matchLabels } } };
}

function pod(ns: string, labels: Record<string, string>, nodeName: string) {
  return { metadata: { namespace: ns, labels }, spec: { nodeName } };
}

describe("findSingleReplicaNoPdb", () => {
  it("flags a single-replica Deployment with no covering PDB", () => {
    const w = [workload("Deployment", "prod", "web", 1, { app: "web" })];
    const findings = findSingleReplicaNoPdb(w, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("no-pdb");
    expect(findings[0]!.name).toBe("web");
  });

  it("does not flag a single-replica workload covered by a matching PDB", () => {
    const w = [workload("Deployment", "prod", "web", 1, { app: "web" })];
    const findings = findSingleReplicaNoPdb(w, [pdb("prod", { app: "web" })]);
    expect(findings).toEqual([]);
  });

  it("does not flag a PDB in a different namespace", () => {
    const w = [workload("Deployment", "prod", "web", 1, { app: "web" })];
    const findings = findSingleReplicaNoPdb(w, [pdb("staging", { app: "web" })]);
    expect(findings).toHaveLength(1);
  });

  it("does not flag a multi-replica workload even without a PDB", () => {
    const w = [workload("Deployment", "prod", "web", 3, { app: "web" })];
    expect(findSingleReplicaNoPdb(w, [])).toEqual([]);
  });

  it("defaults replicas to 1 when unset", () => {
    const w = [{ kind: "Deployment", obj: { metadata: { namespace: "prod", name: "web" }, spec: { template: { metadata: { labels: { app: "web" } } } } } }];
    expect(findSingleReplicaNoPdb(w, [])).toHaveLength(1);
  });

  it("ignores kinds other than Deployment/StatefulSet", () => {
    const w = [workload("DaemonSet", "prod", "agent", 1, { app: "agent" })];
    expect(findSingleReplicaNoPdb(w, [])).toEqual([]);
  });
});

describe("findClusteredReplicas", () => {
  it("flags a multi-replica workload with no spread/anti-affinity whose pods all land on one node", () => {
    const w = [workload("Deployment", "prod", "web", 2, { app: "web" })];
    const pods = [pod("prod", { app: "web" }, "node-1"), pod("prod", { app: "web" }, "node-1")];
    const findings = findClusteredReplicas(w, pods);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("no-spread");
  });

  it("does not flag when pods are spread across nodes", () => {
    const w = [workload("Deployment", "prod", "web", 2, { app: "web" })];
    const pods = [pod("prod", { app: "web" }, "node-1"), pod("prod", { app: "web" }, "node-2")];
    expect(findClusteredReplicas(w, pods)).toEqual([]);
  });

  it("does not flag a workload that already has topologySpreadConstraints", () => {
    const w = [workload("Deployment", "prod", "web", 2, { app: "web" }, { topologySpread: true })];
    const pods = [pod("prod", { app: "web" }, "node-1"), pod("prod", { app: "web" }, "node-1")];
    expect(findClusteredReplicas(w, pods)).toEqual([]);
  });

  it("does not flag a workload that already has pod anti-affinity", () => {
    const w = [workload("Deployment", "prod", "web", 2, { app: "web" }, { antiAffinity: true })];
    const pods = [pod("prod", { app: "web" }, "node-1"), pod("prod", { app: "web" }, "node-1")];
    expect(findClusteredReplicas(w, pods)).toEqual([]);
  });

  it("does not flag a single-replica workload", () => {
    const w = [workload("Deployment", "prod", "web", 1, { app: "web" })];
    expect(findClusteredReplicas(w, [pod("prod", { app: "web" }, "node-1")])).toEqual([]);
  });
});

describe("findSingleReadyBackend", () => {
  function service(ns: string, name: string) {
    return { metadata: { namespace: ns, name } };
  }
  function endpointSlice(ns: string, svcName: string, entries: { ready: boolean; addressCount?: number }[]) {
    return {
      metadata: { namespace: ns, labels: { "kubernetes.io/service-name": svcName } },
      endpoints: entries.map((e) => ({ addresses: new Array(e.addressCount ?? 1).fill("10.0.0.1"), conditions: { ready: e.ready } })),
    };
  }

  it("flags a Service with exactly one ready backend", () => {
    const svcs = [service("prod", "web")];
    const slices = [endpointSlice("prod", "web", [{ ready: true }, { ready: false }])];
    const findings = findSingleReadyBackend(svcs, slices);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("single-backend");
  });

  it("does not flag a Service with multiple ready backends", () => {
    const svcs = [service("prod", "web")];
    const slices = [endpointSlice("prod", "web", [{ ready: true }, { ready: true }])];
    expect(findSingleReadyBackend(svcs, slices)).toEqual([]);
  });

  it("does not flag a Service with no EndpointSlice at all", () => {
    expect(findSingleReadyBackend([service("prod", "web")], [])).toEqual([]);
  });

  it("does not match a slice belonging to a different service", () => {
    const svcs = [service("prod", "web")];
    const slices = [endpointSlice("prod", "other", [{ ready: true }])];
    expect(findSingleReadyBackend(svcs, slices)).toEqual([]);
  });
});

describe("computeSpofFindings", () => {
  it("aggregates all three checks", () => {
    const findings = computeSpofFindings({
      deployments: [workload("Deployment", "prod", "web", 1, { app: "web" }).obj],
      statefulSets: [],
      pdbs: [],
      pods: [],
      services: [],
      endpointSlices: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("no-pdb");
  });
});
