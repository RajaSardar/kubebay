import { describe, expect, it } from "vitest";
import { computeBlastRadius, type BlastStreams } from "../blastRadius";

type O = Record<string, unknown>;

const deploy = (name = "web", labels: Record<string, string> = { app: "web" }): O => ({
  kind: "Deployment",
  metadata: { name, namespace: "shop", uid: `u-${name}` },
  spec: { replicas: 2, selector: { matchLabels: labels }, template: { metadata: { labels } } },
});
const rs = (name: string, owner: string): O => ({
  metadata: { name, namespace: "shop", uid: `u-${name}`, ownerReferences: [{ kind: "Deployment", name: owner, uid: `u-${owner}` }] },
});
const pod = (name: string, over: { owner?: O; labels?: Record<string, string>; node?: string; pvc?: string; ns?: string } = {}): O => ({
  metadata: {
    name,
    namespace: over.ns ?? "shop",
    labels: over.labels ?? { app: "web" },
    ownerReferences: over.owner ? [over.owner] : [],
  },
  spec: {
    nodeName: over.node ?? "n1",
    volumes: over.pvc ? [{ persistentVolumeClaim: { claimName: over.pvc } }] : [],
  },
});
const rsRef = (n: string) => ({ kind: "ReplicaSet", name: n, uid: `u-${n}` });
const svc = (name: string, selector: Record<string, string>): O => ({ metadata: { name, namespace: "shop" }, spec: { selector } });
const ing = (name: string, backend: string): O => ({
  metadata: { name, namespace: "shop" },
  spec: { rules: [{ http: { paths: [{ backend: { service: { name: backend } } }] } }] },
});
const route = (name: string, backend: string): O => ({
  metadata: { name, namespace: "shop" },
  spec: { rules: [{ backendRefs: [{ name: backend }] }] },
});
const hpa = (name: string, target: string): O => ({
  metadata: { name, namespace: "shop" },
  spec: { scaleTargetRef: { kind: "Deployment", name: target } },
});
const pdb = (name: string, labels: Record<string, string>, allowed: number): O => ({
  metadata: { name, namespace: "shop" },
  spec: { selector: { matchLabels: labels } },
  status: { disruptionsAllowed: allowed },
});

const full = (over: Partial<BlastStreams> = {}): BlastStreams => ({
  pods: [pod("web-1", { owner: rsRef("web-rs") }), pod("web-2", { owner: rsRef("web-rs") }), pod("other", { labels: { app: "other" } })],
  replicasets: [rs("web-rs", "web")],
  services: [],
  ingresses: [],
  httproutes: [],
  hpas: [],
  pdbs: [],
  ...over,
});

const item = (r: ReturnType<typeof computeBlastRadius>, id: string) => r.items.find((i) => i.id === id);

describe("computeBlastRadius: Deployment", () => {
  it("lists ReplicaSets and Pods under a deleted Deployment", () => {
    const r = computeBlastRadius({ action: "delete", kind: "Deployment", obj: deploy(), streams: full() });
    expect(item(r, "replicasets")).toMatchObject({ count: 1, examples: ["web-rs"] });
    expect(item(r, "pods")).toMatchObject({ count: 2, examples: ["web-1", "web-2"] });
  });

  it("caps examples at five and reports the rest", () => {
    const pods = Array.from({ length: 8 }, (_, i) => pod(`web-${i}`, { owner: rsRef("web-rs") }));
    const r = computeBlastRadius({ action: "delete", kind: "Deployment", obj: deploy(), streams: full({ pods }) });
    expect(item(r, "pods")).toMatchObject({ count: 8, more: 3 });
    expect(item(r, "pods")!.examples).toHaveLength(5);
  });

  it("flags a Service whose only backends are these pods, and the Ingress and HTTPRoute that reach it", () => {
    const r = computeBlastRadius({
      action: "delete",
      kind: "Deployment",
      obj: deploy(),
      streams: full({ services: [svc("web", { app: "web" })], ingresses: [ing("web-ing", "web")], httproutes: [route("web-route", "web")] }),
    });
    expect(item(r, "services")).toMatchObject({ count: 1, examples: ["web"], tone: "warn" });
    expect(item(r, "ingresses")).toMatchObject({ count: 1, examples: ["web-ing"] });
    expect(item(r, "httproutes")).toMatchObject({ count: 1, examples: ["web-route"] });
  });

  it("does not flag a Service that other pods still back", () => {
    const pods = [pod("web-1", { owner: rsRef("web-rs") }), pod("legacy", { labels: { app: "web" } })];
    const r = computeBlastRadius({
      action: "delete",
      kind: "Deployment",
      obj: deploy(),
      streams: full({ pods, services: [svc("web", { app: "web" })], ingresses: [ing("web-ing", "web")] }),
    });
    expect(item(r, "services")).toBeUndefined();
    expect(item(r, "ingresses")).toBeUndefined();
  });

  it("ignores Services with an empty selector or in another namespace", () => {
    const other = { metadata: { name: "x", namespace: "elsewhere" }, spec: { selector: { app: "web" } } };
    const r = computeBlastRadius({
      action: "delete",
      kind: "Deployment",
      obj: deploy(),
      streams: full({ services: [svc("headless", {}), other] }),
    });
    expect(item(r, "services")).toBeUndefined();
  });

  it("lists HPAs that target the workload", () => {
    const r = computeBlastRadius({
      action: "scale-zero",
      kind: "Deployment",
      obj: deploy(),
      streams: full({ hpas: [hpa("web-hpa", "web"), hpa("other-hpa", "other")] }),
    });
    expect(item(r, "hpas")).toMatchObject({ count: 1, examples: ["web-hpa"] });
  });

  it("marks a PDB violated when the affected pods exceed its disruptions allowed", () => {
    const r = computeBlastRadius({
      action: "scale-zero",
      kind: "Deployment",
      obj: deploy(),
      streams: full({ pdbs: [pdb("web-pdb", { app: "web" }, 1)] }),
    });
    expect(item(r, "pdbs")).toMatchObject({ count: 1, examples: ["web-pdb"], tone: "warn" });
    expect(item(r, "pdbs")!.note).toMatch(/violat/i);
  });

  it("does not call a PDB violated when it allows the disruption", () => {
    const r = computeBlastRadius({
      action: "delete",
      kind: "Deployment",
      obj: deploy(),
      streams: full({ pdbs: [pdb("web-pdb", { app: "web" }, 5)] }),
    });
    expect(item(r, "pdbs")!.tone).toBeUndefined();
  });

  it("restart lists the pods and a PDB but never calls it violated", () => {
    const r = computeBlastRadius({
      action: "restart",
      kind: "Deployment",
      obj: deploy(),
      streams: full({ pdbs: [pdb("web-pdb", { app: "web" }, 0)], services: [svc("web", { app: "web" })] }),
    });
    expect(item(r, "pods")!.count).toBe(2);
    expect(item(r, "pdbs")!.tone).toBeUndefined();
    expect(item(r, "services")).toBeUndefined();
  });

  it("notes retained PVC data", () => {
    const pods = [pod("db-0", { owner: { kind: "StatefulSet", name: "db", uid: "u-db" }, pvc: "data-db-0", labels: { app: "db" } })];
    const sts = {
      kind: "StatefulSet",
      metadata: { name: "db", namespace: "shop", uid: "u-db" },
      spec: { selector: { matchLabels: { app: "db" } }, template: { metadata: { labels: { app: "db" } } } },
    };
    const r = computeBlastRadius({ action: "delete", kind: "StatefulSet", obj: sts, streams: full({ pods }) });
    expect(item(r, "pvcs")).toMatchObject({ count: 1, examples: ["data-db-0"] });
    expect(item(r, "pvcs")!.note).toMatch(/kept|retain/i);
  });
});

describe("computeBlastRadius: Node", () => {
  const node: O = { kind: "Node", metadata: { name: "n1" } };
  const ds = { kind: "DaemonSet", name: "agent", uid: "u-agent" };

  it("drain lists evicted pods and skips DaemonSet pods", () => {
    const pods = [pod("web-1", { owner: rsRef("web-rs") }), pod("agent-x", { owner: ds }), pod("elsewhere", { node: "n2" })];
    const r = computeBlastRadius({ action: "drain", kind: "Node", obj: node, streams: full({ pods }) });
    expect(item(r, "pods")).toMatchObject({ count: 1, examples: ["web-1"] });
  });

  it("drain warns about bare pods that will not come back", () => {
    const pods = [pod("bare")];
    const r = computeBlastRadius({ action: "drain", kind: "Node", obj: node, streams: full({ pods }) });
    expect(item(r, "bare")).toMatchObject({ count: 1, examples: ["bare"], tone: "warn" });
  });

  it("drain flags a Service losing every endpoint", () => {
    const pods = [pod("web-1", { owner: rsRef("web-rs") })];
    const r = computeBlastRadius({ action: "drain", kind: "Node", obj: node, streams: full({ pods, services: [svc("web", { app: "web" })] }) });
    expect(item(r, "services")).toMatchObject({ count: 1, examples: ["web"] });
  });

  it("drain flags a PDB that would block the eviction", () => {
    const pods = [pod("web-1", { owner: rsRef("web-rs") }), pod("web-2", { owner: rsRef("web-rs") })];
    const r = computeBlastRadius({ action: "drain", kind: "Node", obj: node, streams: full({ pods, pdbs: [pdb("p", { app: "web" }, 1)] }) });
    expect(item(r, "pdbs")).toMatchObject({ tone: "warn" });
    expect(item(r, "pdbs")!.note).toMatch(/block/i);
  });

  it("cordon touches no running pod", () => {
    const r = computeBlastRadius({ action: "cordon", kind: "Node", obj: node, streams: full() });
    expect(item(r, "pods")).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/new pods/i);
  });
});

describe("computeBlastRadius: unknown streams and production", () => {
  it("reports unknown when a stream is unreadable and does not guess", () => {
    const r = computeBlastRadius({ action: "delete", kind: "Deployment", obj: deploy(), streams: full({ pods: null }) });
    expect(item(r, "pods")).toMatchObject({ count: null });
    expect(item(r, "services")).toMatchObject({ count: null });
  });

  it("reports unknown PDBs on its own while the rest still computes", () => {
    const r = computeBlastRadius({ action: "delete", kind: "Deployment", obj: deploy(), streams: full({ pdbs: null }) });
    expect(item(r, "pods")!.count).toBe(2);
    expect(item(r, "pdbs")).toMatchObject({ count: null });
  });

  it("adds a production warning and a summary", () => {
    const r = computeBlastRadius({ action: "delete", kind: "Deployment", obj: deploy(), streams: full(), production: true });
    expect(r.warnings.join(" ")).toMatch(/production/i);
    expect(r.summary).toMatch(/2 pods/);
  });

  it("handles kinds it has no model for with only the production warning", () => {
    const r = computeBlastRadius({
      action: "delete",
      kind: "ConfigMap",
      obj: { metadata: { name: "c", namespace: "shop" } },
      streams: full(),
      production: true,
    });
    expect(r.items).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it("a deleted Pod lists itself, and a Service other pods still back is fine", () => {
    const p = pod("web-1", { owner: rsRef("web-rs") });
    const r = computeBlastRadius({ action: "delete", kind: "Pod", obj: p, streams: full({ services: [svc("web", { app: "web" })] }) });
    expect(item(r, "pods")).toMatchObject({ count: 1 });
    expect(item(r, "services")).toBeUndefined();
  });
});
