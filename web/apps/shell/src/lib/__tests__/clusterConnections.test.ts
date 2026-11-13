import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock ws module
vi.mock("../ws", () => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  attach: vi.fn(() => () => {}),
}));

// Mock streamCache
vi.mock("../streamCache", () => ({
  getStreamCache: vi.fn(() => null),
  setStreamCache: vi.fn(),
  clearStreamCacheForCluster: vi.fn(),
}));

import * as ws from "../ws";
import * as cache from "../streamCache";
import {
  connectCluster,
  disconnectCluster,
  getConnectedClusters,
  isClusterConnected,
  resetConnections,
  subscribeConnections,
  getConnectionsVersion,
  connectionError,
  clusterSummary,
  getClusterRows,
  isClusterSynced,
} from "../clusterConnections";

const CORE_GVR_COUNT = 7;

beforeEach(() => {
  resetConnections();
  vi.clearAllMocks();
});

describe("clusterConnections", () => {
  it("connectCluster opens subscriptions for all core GVRs", () => {
    connectCluster("my-cluster");
    expect(ws.subscribe).toHaveBeenCalledTimes(CORE_GVR_COUNT);
    // Every sub must target the right cluster
    const calls = vi.mocked(ws.subscribe).mock.calls;
    for (const [spec] of calls) {
      expect(spec.cluster).toBe("my-cluster");
    }
  });

  it("isClusterConnected returns true after connect", () => {
    expect(isClusterConnected("my-cluster")).toBe(false);
    connectCluster("my-cluster");
    expect(isClusterConnected("my-cluster")).toBe(true);
  });

  it("getConnectedClusters returns all connected cluster IDs", () => {
    connectCluster("cluster-a");
    connectCluster("cluster-b");
    const connected = getConnectedClusters();
    expect(connected.has("cluster-a")).toBe(true);
    expect(connected.has("cluster-b")).toBe(true);
  });

  it("connectCluster is idempotent — second call does not double-subscribe", () => {
    connectCluster("my-cluster");
    const firstCallCount = vi.mocked(ws.subscribe).mock.calls.length;
    connectCluster("my-cluster");
    expect(vi.mocked(ws.subscribe).mock.calls.length).toBe(firstCallCount);
  });

  it("disconnectCluster unsubscribes all subs for that cluster", () => {
    connectCluster("my-cluster");
    disconnectCluster("my-cluster");
    expect(ws.unsubscribe).toHaveBeenCalledTimes(CORE_GVR_COUNT);
  });

  it("disconnectCluster removes cluster from connected set", () => {
    connectCluster("my-cluster");
    disconnectCluster("my-cluster");
    expect(isClusterConnected("my-cluster")).toBe(false);
  });

  it("disconnecting one cluster does not affect another", () => {
    connectCluster("cluster-a");
    connectCluster("cluster-b");
    disconnectCluster("cluster-a");
    expect(isClusterConnected("cluster-b")).toBe(true);
  });
});

describe("clusterConnections is observable", () => {
  it("notifies subscribers on connect and disconnect", () => {
    const seen = vi.fn();
    const off = subscribeConnections(seen);
    const v0 = getConnectionsVersion();
    connectCluster("c1");
    disconnectCluster("c1");
    expect(seen).toHaveBeenCalledTimes(2);
    expect(getConnectionsVersion()).not.toBe(v0);
    off();
  });

  it("disconnect drops the cluster's cached rows", () => {
    connectCluster("c1");
    disconnectCluster("c1");
    expect(cache.clearStreamCacheForCluster).toHaveBeenCalledWith("c1");
  });

  it("a failed subscription is reported, not shown as streaming forever", () => {
    connectCluster("c1");
    const handlers = vi.mocked(ws.attach).mock.calls.at(-1)![0];
    const podsSub = vi.mocked(ws.subscribe).mock.calls.find(([s]) => s.gvr === "v1/pods")![0];
    handlers.onError?.(podsSub.id, "cluster disconnected");
    expect(connectionError("c1")).toBe("cluster disconnected");
  });

  it("summarises pods into healthy / pending / failing and counts nodes", () => {
    connectCluster("c1");
    const handlers = vi.mocked(ws.attach).mock.calls.at(-1)![0];
    const subOf = (gvr: string) => vi.mocked(ws.subscribe).mock.calls.find(([s]) => s.gvr === gvr)![0].id;
    const pod = (name: string, phase: string, waiting?: string) => ({
      op: "a" as const,
      key: `default/${name}`,
      obj: {
        metadata: { name, namespace: "default" },
        spec: { containers: [{ name: "c" }] },
        status: {
          phase,
          containerStatuses: [
            waiting
              ? { name: "c", ready: false, restartCount: 3, state: { waiting: { reason: waiting } } }
              : { name: "c", ready: phase === "Running", restartCount: 0, state: {} },
          ],
        },
      },
    });
    handlers.onItems?.(subOf("v1/pods"), [pod("a", "Running"), pod("b", "Pending"), pod("c", "Running", "CrashLoopBackOff"), pod("d", "Succeeded")]);
    handlers.onSync?.(subOf("v1/pods"));
    handlers.onItems?.(subOf("v1/nodes"), [{ op: "a", key: "n1", obj: { metadata: { name: "n1" } } }, { op: "a", key: "n2", obj: { metadata: { name: "n2" } } }]);
    handlers.onSync?.(subOf("v1/nodes"));
    expect(clusterSummary("c1")).toEqual({ synced: true, pods: { healthy: 2, pending: 1, failing: 1, total: 4 }, nodes: 2 });
    expect(clusterSummary("nope")).toBeNull();
  });
});

describe("getClusterRows", () => {
  it("returns the live rows of a connected cluster's stream, as deltas keep them", () => {
    connectCluster("c1");
    const handlers = vi.mocked(ws.attach).mock.calls.at(-1)![0];
    const subOf = (gvr: string) => vi.mocked(ws.subscribe).mock.calls.find(([s]) => s.gvr === gvr)![0].id;
    handlers.onItems?.(subOf("apps/v1/deployments"), [
      { op: "a", key: "shop/api", obj: { metadata: { name: "api", namespace: "shop" } } },
      { op: "a", key: "shop/web", obj: { metadata: { name: "web", namespace: "shop" } } },
    ]);
    handlers.onSync?.(subOf("apps/v1/deployments"));
    expect(getClusterRows("c1", "apps/v1/deployments", "full").map((r) => (r.metadata as { name: string }).name)).toEqual(["api", "web"]);

    handlers.onDelta?.(subOf("apps/v1/deployments"), [{ op: "d", key: "shop/web" }]);
    expect(getClusterRows("c1", "apps/v1/deployments", "full")).toHaveLength(1);
  });

  it("is empty for a cluster that is not connected, and for a stream it does not follow", () => {
    expect(getClusterRows("nope", "v1/pods", "full")).toEqual([]);
    connectCluster("c1");
    expect(getClusterRows("c1", "v1/services", "full")).toEqual([]);
  });
});

describe("isClusterSynced", () => {
  it("is true only once every followed stream of the cluster has synced", () => {
    expect(isClusterSynced("nope")).toBe(false);
    connectCluster("c1");
    const handlers = vi.mocked(ws.attach).mock.calls.at(-1)![0];
    const subs = vi.mocked(ws.subscribe).mock.calls.map(([s]) => s.id);
    expect(isClusterSynced("c1")).toBe(false);
    for (const id of subs.slice(0, -1)) handlers.onSync?.(id);
    expect(isClusterSynced("c1")).toBe(false);
    handlers.onSync?.(subs.at(-1)!);
    expect(isClusterSynced("c1")).toBe(true);
  });
});
