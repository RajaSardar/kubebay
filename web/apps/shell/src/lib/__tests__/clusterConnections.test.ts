import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
  isClusterSleeping,
  setRowBudget,
  setProtectedClusters,
  setBudgetEvictHook,
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
    handlers.onError?.(podsSub.id, "engine said no");
    expect(connectionError("c1")).toBe("engine said no");
  });

  describe("an engine-evicted (sleeping) cluster", () => {
    const evict = (cluster: string) => {
      const handlers = vi.mocked(ws.attach).mock.calls.at(-1)![0];
      const sub = vi.mocked(ws.subscribe).mock.calls.find(([s]) => s.cluster === cluster && s.gvr === "v1/pods")![0];
      handlers.onError?.(sub.id, "cluster disconnected");
    };

    it("is sleeping, not errored, and no longer counts as streaming", () => {
      connectCluster("c1");
      evict("c1");
      expect(isClusterSleeping("c1")).toBe(true);
      expect(isClusterConnected("c1")).toBe(false);
      expect(getConnectedClusters().has("c1")).toBe(false);
      expect(connectionError("c1")).toBe("");
    });

    it("drops its subscriptions (so a socket replay cannot wake it) and its cached rows", () => {
      connectCluster("c1");
      const ids = vi.mocked(ws.subscribe).mock.calls.map(([s]) => s.id);
      evict("c1");
      for (const id of ids) expect(ws.unsubscribe).toHaveBeenCalledWith(id);
      expect(cache.clearStreamCacheForCluster).toHaveBeenCalledWith("c1");
      expect(getClusterRows("c1", "v1/pods", "full")).toEqual([]);
    });

    it("streams again the next time it is connected, with no leftover sleeping flag", () => {
      connectCluster("c1");
      evict("c1");
      vi.mocked(ws.subscribe).mockClear();
      connectCluster("c1");
      expect(vi.mocked(ws.subscribe)).toHaveBeenCalledTimes(CORE_GVR_COUNT);
      expect(isClusterSleeping("c1")).toBe(false);
      expect(isClusterConnected("c1")).toBe(true);
    });

    it("notifies listeners so the strip and picker redraw", () => {
      connectCluster("c1");
      const before = getConnectionsVersion();
      evict("c1");
      expect(getConnectionsVersion()).toBeGreaterThan(before);
    });
  });

  describe("the global row budget", () => {
    const feed = (cluster: string, n: number) => {
      const handlers = vi.mocked(ws.attach).mock.calls.at(-1)![0];
      const sub = vi.mocked(ws.subscribe).mock.calls.filter(([s]) => s.cluster === cluster && s.gvr === "v1/pods").at(-1)![0];
      handlers.onDelta?.(
        sub.id,
        Array.from({ length: n }, (_, i) => ({ op: "u", key: `default/p${i}`, obj: { metadata: { name: `p${i}`, namespace: "default" } } })),
      );
    };
    afterEach(() => {
      setRowBudget(50_000);
      setProtectedClusters([]);
      setBudgetEvictHook(null);
    });

    it("puts the least recently viewed cluster to sleep once all clusters hold more rows than the budget", () => {
      setRowBudget(10);
      const evicted = vi.fn();
      setBudgetEvictHook(evicted);
      connectCluster("a");
      connectCluster("b");
      feed("a", 6);
      expect(isClusterSleeping("a")).toBe(false);
      feed("b", 6);
      expect(isClusterSleeping("a")).toBe(true);
      expect(isClusterSleeping("b")).toBe(false);
      expect(getClusterRows("a", "v1/pods", "full")).toEqual([]);
      expect(evicted).toHaveBeenCalledWith("a");
    });

    it("counts viewing a cluster again as recent use", () => {
      setRowBudget(10);
      connectCluster("a");
      connectCluster("b");
      connectCluster("a"); // already streaming, but looked at again
      feed("a", 6);
      feed("b", 6);
      expect(isClusterSleeping("b")).toBe(true);
      expect(isClusterSleeping("a")).toBe(false);
    });

    it("never sleeps a protected (active or pinned) cluster", () => {
      setRowBudget(10);
      connectCluster("a");
      connectCluster("b");
      setProtectedClusters(["a"]);
      feed("a", 6);
      feed("b", 6);
      expect(isClusterSleeping("a")).toBe(false);
      expect(isClusterSleeping("b")).toBe(true);
    });

    it("lets a lone cluster exceed the budget: the cap is soft when nothing else can go", () => {
      setRowBudget(10);
      connectCluster("a");
      feed("a", 30);
      expect(isClusterSleeping("a")).toBe(false);
      expect(getClusterRows("a", "v1/pods", "full")).toHaveLength(30);
    });
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

describe("the background streams' cost", () => {
  const setup = () => {
    connectCluster("c1");
    const handlers = vi.mocked(ws.attach).mock.calls.at(-1)![0];
    const subOf = (gvr: string) => vi.mocked(ws.subscribe).mock.calls.find(([s]) => s.gvr === gvr)![0].id;
    const id = subOf("apps/v1/deployments");
    handlers.onItems?.(id, [{ op: "a", key: "shop/api", obj: { metadata: { name: "api", namespace: "shop" } } }]);
    handlers.onSync?.(id);
    vi.mocked(cache.setStreamCache).mockClear();
    return { handlers, id };
  };
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    setVisibility("visible");
    vi.useRealTimers();
  });

  it("copies a stream's rows into the cache once for a burst of updates, not once for each", () => {
    const { handlers, id } = setup();
    for (let i = 0; i < 50; i++) handlers.onDelta?.(id, [{ op: "u", key: `shop/p${i}`, obj: { metadata: { name: `p${i}`, namespace: "shop" } } }]);
    expect(cache.setStreamCache).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2100);
    const calls = vi.mocked(cache.setStreamCache).mock.calls.filter(([k]) => String(k).includes("deployments"));
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toHaveLength(51); // the cache has all of them by then
  });

  it("tells listeners about new data about once a second, but not while the window is hidden", () => {
    const { handlers, id } = setup();
    const listener = vi.fn();
    subscribeConnections(listener);
    setVisibility("hidden");
    handlers.onDelta?.(id, [{ op: "u", key: "shop/x", obj: { metadata: { name: "x", namespace: "shop" } } }]);
    vi.advanceTimersByTime(3000);
    expect(listener).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("still tells listeners within a second while the window is visible", () => {
    const { handlers, id } = setup();
    const listener = vi.fn();
    subscribeConnections(listener);
    handlers.onDelta?.(id, [{ op: "u", key: "shop/x", obj: { metadata: { name: "x", namespace: "shop" } } }]);
    vi.advanceTimersByTime(1100);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
