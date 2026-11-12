import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook as renderHookBare, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ownerSlug, useOwnerChain } from "../useOwnerChain";
import type { CRDEntry } from "../api";

// The CRDs the cluster serves, as /api/crds lists them.
const crds = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  crdApi: { list: vi.fn(async () => crds.list) },
}));

function renderHook<T>(cb: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHookBare(cb, { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children) });
}

// We'll mock useResourceStream so the hook can resolve owner objects in memory.
// Each call maps gvr → rows.
const streamMap: Record<string, Record<string, unknown>[]> = {};

vi.mock("../useResourceStream", () => ({
  useResourceStream: (_cluster: string, gvr: string) => ({
    rows: streamMap[gvr] ?? [],
    synced: true,
  }),
}));

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
    expect(result.current[0]?.kind).toBe("ReplicaSet");
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

// Backlog #20: a pod of an Argo Rollout links up its chain to the Rollout, and
// that link opens the Rollout's page, a custom resource's, not a dead
// "/detail/rollouts/…".
const rollouts: CRDEntry = {
  name: "rollouts.argoproj.io",
  group: "argoproj.io",
  version: "v1alpha1",
  resource: "rollouts",
  kind: "Rollout",
  namespaced: true,
  gvr: "argoproj.io/v1alpha1/rollouts",
  columns: [],
};

describe("ownerSlug", () => {
  it("is a built-in kind's own page", () => {
    expect(ownerSlug({ apiVersion: "apps/v1", kind: "ReplicaSet" })).toBe("replicasets");
    expect(ownerSlug({ apiVersion: "batch/v1", kind: "Job" })).toBe("jobs");
  });

  it("is a custom resource's page by the plural its CRD declares", () => {
    expect(ownerSlug({ apiVersion: "argoproj.io/v1alpha1", kind: "Rollout" }, [rollouts])).toBe("ext--argoproj.io--v1alpha1--rollouts");
    const odd = { ...rollouts, resource: "oddities", kind: "Oddity", gvr: "example.com/v1/oddities", group: "example.com", version: "v1" };
    expect(ownerSlug({ apiVersion: "example.com/v1", kind: "Oddity" }, [odd])).toBe("ext--example.com--v1--oddities");
  });

  it("guesses the plural the usual way before the CRDs have loaded", () => {
    expect(ownerSlug({ apiVersion: "argoproj.io/v1alpha1", kind: "Rollout" })).toBe("ext--argoproj.io--v1alpha1--rollouts");
    expect(ownerSlug({ apiVersion: "example.com/v1", kind: "Policy" })).toBe("ext--example.com--v1--policies");
    expect(ownerSlug({ apiVersion: "example.com/v1", kind: "Address" })).toBe("ext--example.com--v1--addresses");
  });

  it("doesn't mistake a custom kind for a built-in one of the same name", () => {
    expect(ownerSlug({ apiVersion: "example.com/v1", kind: "Deployment" })).toBe("ext--example.com--v1--deployments");
  });
});

describe("useOwnerChain and custom resources", () => {
  it("links a pod's Argo Rollout, through its ReplicaSet, to the Rollout's page", async () => {
    crds.list = [rollouts];
    streamMap["apps/v1/replicasets"] = [
      { metadata: { name: "web-6d4f", namespace: "prod", ownerReferences: [{ apiVersion: "argoproj.io/v1alpha1", kind: "Rollout", name: "web", controller: true }] } },
    ];
    const { result } = renderHook(() => useOwnerChain("kind", "prod", [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "web-6d4f" }]));
    await waitFor(() =>
      expect(result.current[1]).toMatchObject({ kind: "Rollout", name: "web", ns: "prod", slug: "ext--argoproj.io--v1alpha1--rollouts" }),
    );
  });
});

describe("useOwnerChain and cluster-scoped owners", () => {
  it("links a static pod's Node without the pod's namespace, so its page loads", () => {
    const { result } = renderHook(() => useOwnerChain("kind", "kube-system", [{ apiVersion: "v1", kind: "Node", name: "node-a" }]));
    expect(result.current[0]).toMatchObject({ kind: "Node", name: "node-a", slug: "nodes", ns: "" });
  });
});
