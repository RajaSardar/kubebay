import { describe, it, expect } from "vitest";
import { resolveWorkloadOwner, controllerOwner } from "../podOwner";

function pod(owner?: { kind: string; name: string; controller?: boolean }) {
  return {
    metadata: {
      ownerReferences: owner ? [{ kind: owner.kind, name: owner.name, controller: owner.controller ?? true }] : [],
    },
  };
}

function replicaSet(name: string, ns: string, owner?: { kind: string; name: string }) {
  return {
    metadata: {
      name,
      namespace: ns,
      ownerReferences: owner ? [{ kind: owner.kind, name: owner.name, controller: true }] : [],
    },
  };
}

describe("resolveWorkloadOwner", () => {
  it("resolves through a ReplicaSet to its Deployment", () => {
    const p = pod({ kind: "ReplicaSet", name: "app-abc123" });
    const rss = [replicaSet("app-abc123", "default", { kind: "Deployment", name: "app" })];
    expect(resolveWorkloadOwner(p, "default", rss)).toEqual({ kind: "Deployment", name: "app" });
  });

  it("resolves a StatefulSet-owned pod directly", () => {
    const p = pod({ kind: "StatefulSet", name: "db" });
    expect(resolveWorkloadOwner(p, "default", [])).toEqual({ kind: "StatefulSet", name: "db" });
  });

  it("resolves a DaemonSet-owned pod directly", () => {
    const p = pod({ kind: "DaemonSet", name: "node-exporter" });
    expect(resolveWorkloadOwner(p, "default", [])).toEqual({ kind: "DaemonSet", name: "node-exporter" });
  });

  it("returns null for a bare pod with no owner", () => {
    expect(resolveWorkloadOwner(pod(), "default", [])).toBeNull();
  });

  it("returns null when the owning ReplicaSet can't be found", () => {
    const p = pod({ kind: "ReplicaSet", name: "orphan-abc" });
    expect(resolveWorkloadOwner(p, "default", [])).toBeNull();
  });

  it("returns null for a Job-owned pod (out of scope, like the rest of right-sizing)", () => {
    const p = pod({ kind: "Job", name: "backup-123" });
    expect(resolveWorkloadOwner(p, "default", [])).toBeNull();
  });

  it("does not match a ReplicaSet with the same name in a different namespace", () => {
    const p = pod({ kind: "ReplicaSet", name: "app-abc123" });
    const rss = [replicaSet("app-abc123", "other-ns", { kind: "Deployment", name: "app" })];
    expect(resolveWorkloadOwner(p, "default", rss)).toBeNull();
  });
});

describe("controllerOwner (exported for backlog #16's one-hop vulnerability-report join)", () => {
  it("returns the immediate controller reference, one hop only — e.g. a ReplicaSet, not the Deployment above it", () => {
    const p = pod({ kind: "ReplicaSet", name: "app-abc123" });
    expect(controllerOwner(p)).toEqual({ kind: "ReplicaSet", name: "app-abc123" });
  });

  it("returns null for a bare pod with no controller reference", () => {
    expect(controllerOwner(pod())).toBeNull();
  });

  it("ignores a non-controller ownerReference", () => {
    const p = pod({ kind: "ReplicaSet", name: "app-abc123", controller: false });
    expect(controllerOwner(p)).toBeNull();
  });
});
