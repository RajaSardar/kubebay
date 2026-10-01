import { describe, expect, it } from "vitest";
import { compareFleet, type ClusterObjects } from "../fleetConsistency";

function dep(ns: string, name: string, opts: { image?: string; replicas?: number; cpu?: string; env?: Record<string, string>; secretEnv?: Record<string, [string, string]>; extraContainer?: string } = {}) {
  const env = [
    ...Object.entries(opts.env ?? {}).map(([n, v]) => ({ name: n, value: v })),
    ...Object.entries(opts.secretEnv ?? {}).map(([n, [s, k]]) => ({ name: n, valueFrom: { secretKeyRef: { name: s, key: k } } })),
  ];
  const containers: Record<string, unknown>[] = [
    { name: "app", image: opts.image ?? "shop/api:1.0", env, resources: opts.cpu ? { requests: { cpu: opts.cpu } } : {} },
  ];
  if (opts.extraContainer) containers.push({ name: opts.extraContainer, image: "sidecar:1" });
  return {
    metadata: { name, namespace: ns },
    spec: { replicas: opts.replicas ?? 2, template: { spec: { containers } } },
  };
}

function cm(ns: string, name: string, data: Record<string, string>) {
  return { metadata: { name, namespace: ns }, data };
}

function cluster(name: string, o: Partial<ClusterObjects["objects"]>): ClusterObjects {
  return { cluster: name, objects: { deployments: [], statefulsets: [], daemonsets: [], configmaps: [], ...o } };
}

describe("compareFleet", () => {
  it("reports nothing when the same workload is identical everywhere", () => {
    const r = compareFleet([cluster("eu", { deployments: [dep("shop", "api")] }), cluster("us", { deployments: [dep("shop", "api")] })]);
    expect(r.drifts).toEqual([]);
    expect(r.compared).toBe(1);
  });

  it("flags an image that differs between clusters, with each cluster's value", () => {
    const r = compareFleet([
      cluster("eu", { deployments: [dep("shop", "api", { image: "shop/api:1.4" })] }),
      cluster("us", { deployments: [dep("shop", "api", { image: "shop/api:1.3" })] }),
    ]);
    expect(r.drifts).toHaveLength(1);
    const d = r.drifts[0]!;
    expect(d).toMatchObject({ kind: "Deployment", namespace: "shop", name: "api" });
    expect(d.fields).toEqual([
      { path: "containers[app].image", severity: "high", values: { eu: "shop/api:1.4", us: "shop/api:1.3" } },
    ]);
  });

  it("compares resources, env values and replicas, and ranks image drift first", () => {
    const r = compareFleet([
      cluster("eu", { deployments: [dep("shop", "api", { cpu: "500m", env: { REGION: "eu", MODE: "x" }, replicas: 3 }), dep("shop", "web", { image: "web:2" })] }),
      cluster("us", { deployments: [dep("shop", "api", { cpu: "250m", env: { REGION: "us" }, replicas: 2 }), dep("shop", "web", { image: "web:1" })] }),
    ]);
    expect(r.drifts.map((d) => d.name)).toEqual(["web", "api"]);
    const api = r.drifts.find((d) => d.name === "api")!;
    expect(api.fields.map((f) => [f.path, f.severity])).toEqual([
      ["containers[app].resources.requests.cpu", "medium"],
      ["containers[app].env.MODE", "medium"],
      ["containers[app].env.REGION", "medium"],
      ["replicas", "low"],
    ]);
    expect(api.fields.find((f) => f.path === "containers[app].env.MODE")!.values).toEqual({ eu: "x", us: undefined });
  });

  it("shows a secret-backed env var by reference, never by value", () => {
    const r = compareFleet([
      cluster("eu", { deployments: [dep("shop", "api", { secretEnv: { DB_PASSWORD: ["db-eu", "pw"] } })] }),
      cluster("us", { deployments: [dep("shop", "api", { secretEnv: { DB_PASSWORD: ["db-us", "pw"] } })] }),
    ]);
    expect(r.drifts[0]!.fields[0]).toMatchObject({
      path: "containers[app].env.DB_PASSWORD",
      values: { eu: "secret db-eu/pw", us: "secret db-us/pw" },
    });
  });

  it("flags a container present in only some clusters", () => {
    const r = compareFleet([
      cluster("eu", { deployments: [dep("shop", "api", { extraContainer: "envoy" })] }),
      cluster("us", { deployments: [dep("shop", "api")] }),
    ]);
    expect(r.drifts[0]!.fields).toEqual([
      { path: "containers[envoy]", severity: "high", values: { eu: "sidecar:1", us: undefined } },
    ]);
  });

  it("compares ConfigMap keys by value but skips per-cluster ones", () => {
    const r = compareFleet([
      cluster("eu", { configmaps: [cm("shop", "settings", { timeout: "30s", flag: "on" }), cm("shop", "kube-root-ca.crt", { "ca.crt": "A" })] }),
      cluster("us", { configmaps: [cm("shop", "settings", { timeout: "10s", flag: "on" }), cm("shop", "kube-root-ca.crt", { "ca.crt": "B" })] }),
    ]);
    expect(r.drifts).toHaveLength(1);
    expect(r.drifts[0]).toMatchObject({ kind: "ConfigMap", name: "settings" });
    expect(r.drifts[0]!.fields).toEqual([{ path: "data.timeout", severity: "medium", values: { eu: "30s", us: "10s" } }]);
  });

  it("skips kube-system and other kube-* namespaces", () => {
    const r = compareFleet([
      cluster("eu", { daemonsets: [dep("kube-system", "kube-proxy", { image: "kp:1.30" })] }),
      cluster("us", { daemonsets: [dep("kube-system", "kube-proxy", { image: "kp:1.29" })] }),
    ]);
    expect(r.drifts).toEqual([]);
  });

  it("lists objects missing from a cluster only when their namespace exists there", () => {
    const r = compareFleet([
      cluster("eu", { deployments: [dep("shop", "api"), dep("shop", "worker"), dep("eu-only", "x")] }),
      cluster("us", { deployments: [dep("shop", "api")] }),
    ]);
    expect(r.missing).toEqual([{ kind: "Deployment", namespace: "shop", name: "worker", presentIn: ["eu"], missingFrom: ["us"] }]);
  });

  it("only compares clusters that hold the object", () => {
    const r = compareFleet([
      cluster("eu", { deployments: [dep("shop", "api", { image: "a:2" })] }),
      cluster("us", { deployments: [dep("shop", "api", { image: "a:1" })] }),
      cluster("ap", { deployments: [] }),
    ]);
    expect(r.drifts[0]!.clusters).toEqual(["eu", "us"]);
    expect(r.drifts[0]!.fields[0]!.values).toEqual({ eu: "a:2", us: "a:1" });
  });
});
