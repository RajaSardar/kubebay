import { describe, expect, it } from "vitest";
import { buildAllNamespacesMap, ALL_NAMESPACES } from "../serviceMapAll";
import type { ServiceMapInput } from "../serviceMap";

type Objs = Omit<ServiceMapInput, "namespace">;
const empty = (): Objs => ({
  ingresses: [], services: [], slices: [], pods: [], replicaSets: [], deployments: [], statefulSets: [], daemonSets: [], networkPolicies: [],
});
const dep = (ns: string, name: string) => ({ metadata: { name, namespace: ns }, spec: { replicas: 1 }, status: { readyReplicas: 1 } });
const svc = (ns: string, name: string) => ({ metadata: { name, namespace: ns }, spec: { selector: { app: name } } });
const pod = (ns: string, name: string, app: string) => ({ metadata: { name, namespace: ns, labels: { app }, ownerReferences: [{ kind: "Deployment", name: app }] } });

describe("buildAllNamespacesMap", () => {
  it("exports a sentinel that is not a valid namespace name", () => {
    expect(ALL_NAMESPACES).toMatch(/[^a-z0-9-]/);
  });

  it("groups nodes per namespace and keeps same-named workloads apart", () => {
    const o = empty();
    o.deployments = [dep("a", "api"), dep("b", "api")];
    o.services = [svc("a", "api"), svc("b", "api")];
    o.pods = [pod("a", "api-1", "api"), pod("b", "api-1", "api")];
    const g = buildAllNamespacesMap(o, { budget: 400 });
    const ids = g.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(g.nodes.filter((n) => n.type === "group").map((n) => n.name).sort()).toEqual(["a", "b"]);
    expect(g.nodes.filter((n) => n.type === "workload" && n.group === "a")).toHaveLength(1);
    expect(g.nodes.filter((n) => n.type === "workload" && n.group === "b")).toHaveLength(1);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const serves = g.edges.filter((e) => e.kind === "serves");
    expect(serves).toHaveLength(2);
    for (const e of serves) expect(byId.get(e.source)!.group).toBe(byId.get(e.target)!.group);
    expect(g.truncated).toBe(false);
  });

  it("joins a cross-namespace reference to the real Service node", () => {
    const o = empty();
    o.deployments = [
      { metadata: { name: "web", namespace: "a" }, spec: { replicas: 1, template: { spec: { containers: [{ env: [{ name: "DB", value: "pg.b.svc" }] }] } } }, status: { readyReplicas: 1 } },
    ];
    o.services = [svc("b", "pg")];
    const g = buildAllNamespacesMap(o, { budget: 400 });
    const pg = g.nodes.filter((n) => n.name === "pg");
    expect(pg).toHaveLength(1);
    expect(pg[0]!.external).toBeFalsy();
    expect(pg[0]!.group).toBe("b");
    expect(g.edges.some((e) => e.kind === "references" && e.target === pg[0]!.id)).toBe(true);
  });

  it("caps the nodes at the budget, says how many there are, and drops dangling edges", () => {
    const o = empty();
    for (let i = 0; i < 10; i++) o.services.push(svc(`ns${i}`, "api"), svc(`ns${i}`, "db"));
    const g = buildAllNamespacesMap(o, { budget: 6 });
    expect(g.nodes.filter((n) => n.type !== "group")).toHaveLength(6);
    expect(g.truncated).toBe(true);
    expect(g.total).toBe(20);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
    for (const f of g.findings) expect(ids.has(f.nodeId)).toBe(true);
  });

  it("gives every node its own position", () => {
    const o = empty();
    o.services = [svc("a", "x"), svc("a", "y"), svc("b", "z")];
    const g = buildAllNamespacesMap(o, { budget: 400 });
    const pos = new Set(g.nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(pos.size).toBe(g.nodes.length);
  });
});
