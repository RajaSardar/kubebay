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
import {
  connectCluster,
  disconnectCluster,
  getConnectedClusters,
  isClusterConnected,
  resetConnections,
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
