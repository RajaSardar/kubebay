import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOwnerChain } from "../useOwnerChain";

// We'll mock useResourceStream so the hook can resolve owner objects in memory.
// Each call maps gvr → rows.
const streamMap: Record<string, Record<string, unknown>[]> = {};

vi.mock("../useResourceStream", () => ({
  useResourceStream: (_cluster: string, gvr: string) => ({
    rows: streamMap[gvr] ?? [],
    synced: true,
  }),
}));

function pod(name: string, ownerKind: string, ownerName: string, apiVersion = "apps/v1") {
  return { metadata: { name, namespace: "prod", ownerReferences: [{ apiVersion, kind: ownerKind, name: ownerName }] } };
}
function rs(name: string, ownerKind?: string, ownerName?: string) {
  return {
    metadata: {
      name,
      namespace: "prod",
      ...(ownerKind ? { ownerReferences: [{ apiVersion: "apps/v1", kind: ownerKind, name: ownerName }] } : {}),
    },
  };
}

describe("useOwnerChain", () => {
  it("returns empty array when there are no ownerReferences", () => {
    const { result } = renderHook(() => useOwnerChain("kind", "prod", []));
    expect(result.current).toEqual([]);
  });

  it("returns just the direct owner when it has no further owners", () => {
    streamMap["apps/v1/statefulsets"] = [rs("db-0")];
    const { result } = renderHook(() =>
      useOwnerChain("kind", "prod", [{ apiVersion: "apps/v1", kind: "StatefulSet", name: "db-0" }]),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ kind: "StatefulSet", name: "db-0", slug: "statefulsets" });
  });

  it("follows two levels: Pod ownerRef → ReplicaSet → Deployment", () => {
    streamMap["apps/v1/replicasets"] = [rs("web-abc", "Deployment", "web")];
    streamMap["apps/v1/deployments"] = [rs("web")]; // no further owners
    const { result } = renderHook(() =>
      useOwnerChain("kind", "prod", [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "web-abc" }]),
    );
    expect(result.current).toHaveLength(2);
    expect(result.current[0]).toMatchObject({ kind: "ReplicaSet", name: "web-abc", slug: "replicasets" });
    expect(result.current[1]).toMatchObject({ kind: "Deployment", name: "web", slug: "deployments" });
  });

  it("follows three levels: Pod → ReplicaSet → Deployment → (no further)", () => {
    streamMap["apps/v1/replicasets"] = [rs("web-abc", "Deployment", "web")];
    streamMap["apps/v1/deployments"] = [rs("web")];
    const refs = [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "web-abc" }];
    const { result } = renderHook(() => useOwnerChain("kind", "prod", refs));
    expect(result.current.map((o) => o.kind)).toEqual(["ReplicaSet", "Deployment"]);
  });

  it("stops gracefully when an owner is not found in its stream (CRD/unknown)", () => {
    streamMap["apps/v1/replicasets"] = []; // RS not in stream
    const { result } = renderHook(() =>
      useOwnerChain("kind", "prod", [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "web-abc" }]),
    );
    // Still shows the RS link, just can't follow further
    expect(result.current).toHaveLength(1);
    expect(result.current[0].kind).toBe("ReplicaSet");
  });

  it("stops when owner kind is unknown (CRD not in OWNER_GVR map)", () => {
    const { result } = renderHook(() =>
      useOwnerChain("kind", "prod", [{ apiVersion: "custom.io/v1", kind: "MyOperator", name: "op-1" }]),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ kind: "MyOperator", name: "op-1" });
  });

  it("prevents infinite cycles", () => {
    // A points to B, B points to A (pathological cycle)
    streamMap["apps/v1/replicasets"] = [
      { metadata: { name: "rs-a", namespace: "prod", ownerReferences: [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "rs-b" }] } },
    ];
    // rs-b not in stream so chain breaks
    const { result } = renderHook(() =>
      useOwnerChain("kind", "prod", [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "rs-a" }]),
    );
    expect(result.current.length).toBeLessThanOrEqual(3);
  });

  it("includes Job → CronJob chain", () => {
    streamMap["batch/v1/jobs"] = [
      { metadata: { name: "backup-xyz", namespace: "prod", ownerReferences: [{ apiVersion: "batch/v1", kind: "CronJob", name: "backup" }] } },
    ];
    streamMap["batch/v1/cronjobs"] = [{ metadata: { name: "backup", namespace: "prod" } }];
    const { result } = renderHook(() =>
      useOwnerChain("kind", "prod", [{ apiVersion: "batch/v1", kind: "Job", name: "backup-xyz" }]),
    );
    expect(result.current.map((o) => o.kind)).toEqual(["Job", "CronJob"]);
  });
});
