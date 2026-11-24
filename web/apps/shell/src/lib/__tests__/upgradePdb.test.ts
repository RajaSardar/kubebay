import { describe, it, expect } from "vitest";
import { pdbDrainBlockers, resolveIntOrPercent } from "../upgradePdb";

type O = Record<string, unknown>;
const pod = (name: string, node: string, labels: Record<string, string>, owner?: [string, string], phase = "Running", ns = "a"): O => ({
  metadata: { name, namespace: ns, labels, ownerReferences: owner ? [{ kind: owner[0], name: owner[1] }] : [] },
  spec: { nodeName: node },
  status: { phase },
});
const pdb = (spec: O, status?: O, name = "p", ns = "a"): O => ({
  metadata: { name, namespace: ns },
  spec: { selector: { matchLabels: { app: "web" } }, ...spec },
  ...(status ? { status } : {}),
});
const web = (n: string, node: string, rs = "web-5d4f8c7b9") => pod(n, node, { app: "web" }, ["ReplicaSet", rs]);

describe("resolveIntOrPercent", () => {
  it("handles ints, percentages (rounded up) and junk", () => {
    expect(resolveIntOrPercent(2, 10)).toBe(2);
    expect(resolveIntOrPercent("30%", 4)).toBe(2);
    expect(resolveIntOrPercent("100%", 3)).toBe(3);
    expect(resolveIntOrPercent("0%", 3)).toBe(0);
    expect(resolveIntOrPercent("2", 3)).toBe(2);
    expect(resolveIntOrPercent(undefined, 3)).toBeUndefined();
    expect(resolveIntOrPercent("abc", 3)).toBeUndefined();
  });
});

describe("pdbDrainBlockers", () => {
  it("flags a PDB with disruptionsAllowed 0, listing nodes and workloads", () => {
    const f = pdbDrainBlockers([pdb({ minAvailable: 2 }, { disruptionsAllowed: 0 })], [web("w1", "n1"), web("w2", "n2")]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ name: "p", ns: "a", reason: "no-disruptions", nodes: ["n1", "n2"] });
    expect(f[0]!.workloads).toEqual([{ kind: "Deployment", name: "web" }]);
    expect(f[0]!.suggestion).toMatch(/minAvailable|maxUnavailable|replica/i);
  });

  it("ignores a PDB that allows disruptions", () => {
    expect(pdbDrainBlockers([pdb({ minAvailable: 1 }, { disruptionsAllowed: 1 })], [web("w1", "n1"), web("w2", "n2")])).toEqual([]);
  });

  it("falls back to the spec when status is missing: maxUnavailable 0, 0%, minAvailable 100%", () => {
    const pods = [web("w1", "n1"), web("w2", "n2")];
    expect(pdbDrainBlockers([pdb({ maxUnavailable: 0 })], pods)).toHaveLength(1);
    expect(pdbDrainBlockers([pdb({ maxUnavailable: "0%" })], pods)).toHaveLength(1);
    expect(pdbDrainBlockers([pdb({ minAvailable: "100%" })], pods)).toHaveLength(1);
    expect(pdbDrainBlockers([pdb({ minAvailable: 2 })], pods)).toHaveLength(1);
    expect(pdbDrainBlockers([pdb({ minAvailable: "50%" })], pods)).toEqual([]);
    expect(pdbDrainBlockers([pdb({ maxUnavailable: "25%" })], pods)).toEqual([]);
  });

  it("only counts running pods, ignoring PDBs that match nothing or other namespaces", () => {
    const pending = pod("w3", "n3", { app: "web" }, undefined, "Pending");
    expect(pdbDrainBlockers([pdb({ minAvailable: 1 }, { disruptionsAllowed: 0 })], [pending])).toEqual([]);
    expect(pdbDrainBlockers([pdb({ minAvailable: 1 }, { disruptionsAllowed: 0 })], [pod("x", "n1", { app: "web" }, undefined, "Running", "other")])).toEqual([]);
  });

  it("calls a blocked single-replica workload out as one that can never drain", () => {
    const f = pdbDrainBlockers([pdb({ minAvailable: 1 }, { disruptionsAllowed: 0 })], [pod("db-0", "n1", { app: "web" }, ["StatefulSet", "db"])]);
    expect(f[0]).toMatchObject({ reason: "single-replica", nodes: ["n1"] });
    expect(f[0]!.workloads).toEqual([{ kind: "StatefulSet", name: "db" }]);
    expect(f[0]!.suggestion).toMatch(/replica/i);
  });

  it("tolerates a PDB with no selector or missing fields", () => {
    expect(pdbDrainBlockers([{ metadata: { name: "x", namespace: "a" } }, {}], [web("w1", "n1")])).toEqual([]);
  });
});
