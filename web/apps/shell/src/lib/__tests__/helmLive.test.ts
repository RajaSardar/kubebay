import { describe, expect, it } from "vitest";
import { joinReleaseResources, liveSummary, podsNeededIn, releaseStreams, resourceKey, streamPicker } from "../helmLive";
import type { ReleaseResource } from "../api";
import type { StreamState } from "../useResourceStream";

// ADR 0004 S9: what a release created, live. Each object is joined against a
// stream: the one Kubebay already keeps for its kind, else one the drawer
// opens in the namespaces the release uses. Refused is "can't check", never
// "missing".

type Obj = Record<string, unknown>;

const res = (over: Partial<ReleaseResource>): ReleaseResource => ({
  apiVersion: "v1",
  kind: "ConfigMap",
  resource: "configmaps",
  namespace: "shop",
  name: "web",
  namespaced: true,
  served: true,
  ...over,
});

const deploy = res({ apiVersion: "apps/v1", kind: "Deployment", resource: "deployments" });
const sts = res({ apiVersion: "apps/v1", kind: "StatefulSet", resource: "statefulsets", name: "db" });
const secret = res({ kind: "Secret", resource: "secrets", name: "web-db" });
const secretData = res({ kind: "Secret", resource: "secrets", name: "web-cache", namespace: "data" });
const role = res({ apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", resource: "clusterroles", name: "web-reader", namespace: undefined, namespaced: false });
const widget = res({ apiVersion: "example.com/v1", kind: "Widget", resource: undefined, name: "gizmo", served: false });

const stream = (rows: Obj[], over: Partial<StreamState> = {}): StreamState => ({ rows, synced: true, connected: true, ...over });
const meta = (namespace: string | undefined, name: string, extra: Obj = {}) => ({ metadata: { ...(namespace ? { namespace } : {}), name, ...extra } });

describe("releaseStreams", () => {
  it("streams each kind in the release's namespaces, a cluster-scoped one cluster-wide, and none for a kind not served", () => {
    // Each subscription is sent its own snapshot: a cluster-wide stream would
    // send every Deployment in the cluster to the drawer.
    const specs = releaseStreams([deploy, secret, secretData, role, widget], []);
    expect(specs.map(({ gvr, mode, ns }) => ({ gvr, mode, ns }))).toEqual([
      { gvr: "apps/v1/deployments", mode: "full", ns: ["shop"] },
      { gvr: "v1/secrets", mode: "metadata", ns: ["data", "shop"] },
      { gvr: "rbac.authorization.k8s.io/v1/clusterroles", mode: "metadata", ns: undefined },
    ]);
    expect(new Set(specs.map((s) => s.key)).size).toBe(specs.length);
  });

  it("streams pods only where a workload isn't ready, to say why", () => {
    expect(releaseStreams([deploy, secret], ["shop"]).map(({ gvr, mode, ns }) => `${gvr} ${mode} ${ns?.join(",")}`)).toEqual([
      "apps/v1/deployments full shop",
      "v1/secrets metadata shop",
      "v1/pods full shop",
    ]);
  });
});

describe("podsNeededIn", () => {
  it("names the namespaces of workloads that aren't ready", () => {
    const statuses = new Map([
      [resourceKey(deploy), { state: "not-ready" as const }],
      [resourceKey(sts), { state: "ready" as const }],
      [resourceKey(secret), { state: "missing" as const }],
    ]);
    expect(podsNeededIn([deploy, sts, secret], statuses)).toEqual(["shop"]);
    expect(podsNeededIn([sts, secret], statuses)).toEqual([]);
  });
});

describe("joinReleaseResources", () => {
  const ready = {
    ...meta("shop", "web", { generation: 2 }),
    spec: { replicas: 3 },
    status: { observedGeneration: 2, replicas: 3, updatedReplicas: 3, readyReplicas: 3, availableReplicas: 3 },
  };

  function join(resources: ReleaseResource[], streams: Record<string, StreamState | undefined>, now = Date.now()) {
    const out = joinReleaseResources(resources, (gvr) => streams[gvr], now);
    return Object.fromEntries(resources.map((r) => [r.name, out.get(resourceKey(r))]));
  }

  it("a Deployment is ready when every copy is updated and available", () => {
    expect(join([deploy], { "apps/v1/deployments": stream([ready]) }).web).toEqual({ state: "ready", why: "3 of 3 ready" });
  });

  it("a Deployment mid-rollout is progressing", () => {
    const rolling = { ...ready, status: { ...ready.status, replicas: 4, updatedReplicas: 1 } };
    expect(join([deploy], { "apps/v1/deployments": stream([rolling]) }).web).toEqual({ state: "progressing", why: "1 of 3 updated" });
    const unseen = { ...ready, metadata: { ...ready.metadata, generation: 3 } };
    expect(join([deploy], { "apps/v1/deployments": stream([unseen]) }).web?.state).toBe("progressing");
  });

  it("a Deployment short of copies is not ready, and says why from its pods", () => {
    const short = { ...ready, status: { ...ready.status, readyReplicas: 1, availableReplicas: 1 } };
    const crashing = {
      metadata: { namespace: "shop", name: "web-abc-1", labels: { "pod-template-hash": "abc" }, ownerReferences: [{ controller: true, kind: "ReplicaSet", name: "web-abc" }] },
      status: { phase: "Running", containerStatuses: [{ ready: false, restartCount: 4, state: { waiting: { reason: "CrashLoopBackOff" } } }] },
    };
    expect(join([deploy], { "apps/v1/deployments": stream([short]), "v1/pods": stream([crashing]) }).web).toEqual({
      state: "not-ready",
      why: "1 of 3 available: keeps crashing on start",
    });
    expect(join([deploy], { "apps/v1/deployments": stream([short]) }).web).toEqual({ state: "not-ready", why: "1 of 3 available" });
  });

  it("a Deployment whose rollout passed its deadline is not ready", () => {
    const stuck = {
      ...ready,
      status: { ...ready.status, replicas: 4, updatedReplicas: 1, conditions: [{ type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded" }] },
    };
    expect(join([deploy], { "apps/v1/deployments": stream([stuck]) }).web).toEqual({ state: "not-ready", why: "its rollout passed its deadline" });
  });

  it("a StatefulSet is ready when its pods are ready on the current revision", () => {
    const base = { ...meta("shop", "db", { generation: 1 }), spec: { replicas: 2 } };
    const at = (status: Obj) => join([sts], { "apps/v1/statefulsets": stream([{ ...base, status: { observedGeneration: 1, ...status } }]) }).db;
    expect(at({ readyReplicas: 2, updatedReplicas: 2, currentRevision: "db-2", updateRevision: "db-2" })).toEqual({ state: "ready", why: "2 of 2 ready" });
    expect(at({ readyReplicas: 2, updatedReplicas: 1, currentRevision: "db-1", updateRevision: "db-2" })).toEqual({ state: "progressing", why: "1 of 2 updated" });
    expect(at({ readyReplicas: 1, updatedReplicas: 2, currentRevision: "db-2", updateRevision: "db-2" })).toEqual({ state: "not-ready", why: "1 of 2 ready" });
  });

  it("a Job is ready once complete, not ready once failed, else running", () => {
    const job = res({ apiVersion: "batch/v1", kind: "Job", resource: "jobs", name: "migrate" });
    const at = (conditions: Obj[]) => join([job], { "batch/v1/jobs": stream([{ ...meta("shop", "migrate"), status: { conditions } }]) }).migrate;
    expect(at([{ type: "Complete", status: "True" }])).toEqual({ state: "ready", why: "complete" });
    expect(at([{ type: "Failed", status: "True", message: "Job has reached the specified backoff limit" }])).toEqual({
      state: "not-ready",
      why: "Job has reached the specified backoff limit",
    });
    expect(at([])).toEqual({ state: "progressing", why: "running" });
  });

  it("a claim is ready once bound", () => {
    const pvc = res({ kind: "PersistentVolumeClaim", resource: "persistentvolumeclaims", name: "data" });
    const at = (phase: string) => join([pvc], { "v1/persistentvolumeclaims": stream([{ ...meta("shop", "data"), status: { phase } }]) }).data;
    expect(at("Bound")).toEqual({ state: "ready", why: "bound" });
    expect(at("Pending")).toEqual({ state: "progressing", why: "waiting for a volume" });
  });

  it("anything else is present when it's there and missing when it isn't", () => {
    const out = join([secret, role], {
      "v1/secrets": stream([meta("shop", "web-db")]),
      "rbac.authorization.k8s.io/v1/clusterroles": stream([]),
    });
    expect(out["web-db"]).toEqual({ state: "present" });
    expect(out["web-reader"]).toEqual({ state: "missing", why: "not in the cluster" });
  });

  it("is checking until its stream has synced, unless the object has already arrived", () => {
    expect(join([secret], { "v1/secrets": stream([], { synced: false }) })["web-db"]).toEqual({ state: "checking" });
    expect(join([secret], {})["web-db"]).toEqual({ state: "checking" });
    expect(join([secret], { "v1/secrets": stream([meta("shop", "web-db")], { synced: false }) })["web-db"]).toEqual({ state: "present" });
  });

  it("can't check what the identity can't list, and never calls it missing", () => {
    const refused = 'secrets is forbidden: User "dev" cannot list resource "secrets" in the namespace "data"';
    const out = join([secret, secretData], { "v1/secrets": stream([], { denied: [{ ns: "data", reason: refused }] }) });
    expect(out["web-cache"]).toEqual({ state: "cant-check", why: refused });
    expect(out["web-db"]).toEqual({ state: "missing", why: "not in the cluster" });
    const wide = 'clusterroles.rbac.authorization.k8s.io is forbidden: User "dev" cannot list resource "clusterroles"';
    expect(join([role], { "rbac.authorization.k8s.io/v1/clusterroles": stream([], { synced: false, forbidden: wide }) })["web-reader"]).toEqual({
      state: "cant-check",
      why: wide,
    });
  });

  it("leaves out a kind the cluster doesn't serve", () => {
    expect(join([widget], {}).gizmo).toBeUndefined();
  });
});

describe("liveSummary", () => {
  it("counts the objects by state, the worst first; ready and present are both ok", () => {
    expect(
      liveSummary([
        { state: "ready" },
        { state: "present" },
        { state: "missing" },
        { state: "progressing" },
        { state: "ready" },
        { state: "not-ready" },
        { state: "cant-check" },
      ]),
    ).toBe("1 missing · 1 not ready · 1 progressing · 3 ok · 1 can't check");
    expect(liveSummary([{ state: "checking" }, { state: "ready" }])).toBe("checking…");
    expect(liveSummary([])).toBe("");
  });
});

describe("streamPicker", () => {
  it("reads each kind from the stream planned for it", () => {
    const specs = releaseStreams([deploy, secret], []);
    const deployments = stream([]);
    const pick = streamPicker(specs, { [specs[0]!.key]: deployments });
    expect(pick("apps/v1/deployments")).toBe(deployments);
    expect(pick("v1/secrets")).toBeUndefined();
    expect(pick("v1/pods")).toBeUndefined();
  });
});
