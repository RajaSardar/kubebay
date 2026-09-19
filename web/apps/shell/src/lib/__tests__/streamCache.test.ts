import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllStreamCache,
  clearStreamCacheForCluster,
  getStreamCache,
  setStreamCache,
  streamCacheSize,
} from "../streamCache";

const key1 = "prod|v1/pods|*||metadata";
const key2 = "prod|apps/v1/deployments|*||metadata";
const key3 = "staging|v1/pods|*||metadata";

const sampleEntries: [string, Record<string, unknown>][] = [
  ["default/nginx", { metadata: { name: "nginx" } }],
  ["default/api", { metadata: { name: "api" } }],
];

beforeEach(() => {
  clearAllStreamCache();
});

describe("setStreamCache / getStreamCache", () => {
  it("returns null for a key that was never set", () => {
    expect(getStreamCache("nonexistent")).toBeNull();
  });

  it("returns the entry immediately after setting it", () => {
    setStreamCache(key1, sampleEntries, true);
    const entry = getStreamCache(key1);
    expect(entry).not.toBeNull();
    expect(entry?.synced).toBe(true);
    expect(entry?.entries).toHaveLength(2);
    expect(entry?.entries[0]?.[0]).toBe("default/nginx");
  });

  it("stores synced=false correctly", () => {
    setStreamCache(key1, [], false);
    const entry = getStreamCache(key1);
    expect(entry?.synced).toBe(false);
  });

  it("overwrites an existing entry", () => {
    setStreamCache(key1, sampleEntries, true);
    const updated: [string, Record<string, unknown>][] = [["kube-system/coredns", {}]];
    setStreamCache(key1, updated, true);
    const entry = getStreamCache(key1);
    expect(entry?.entries).toHaveLength(1);
    expect(entry?.entries[0]?.[0]).toBe("kube-system/coredns");
  });

  // Regression: old code evicted on 5-min TTL causing a loading flash.
  // Entries must persist indefinitely until explicitly cleared.
  it("does not evict entries — no TTL", () => {
    setStreamCache(key1, sampleEntries, true);
    // Simulate the old 5-min TTL having elapsed by checking the entry still exists.
    // There is no savedAt field in the new implementation.
    const entry = getStreamCache(key1);
    expect(entry).not.toBeNull();
    expect((entry as Record<string, unknown>)["savedAt"]).toBeUndefined();
  });
});

describe("clearStreamCacheForCluster", () => {
  it("removes only keys prefixed with the given cluster id", () => {
    setStreamCache(key1, sampleEntries, true); // prod
    setStreamCache(key2, sampleEntries, true); // prod
    setStreamCache(key3, sampleEntries, true); // staging

    clearStreamCacheForCluster("prod");

    expect(getStreamCache(key1)).toBeNull();
    expect(getStreamCache(key2)).toBeNull();
    expect(getStreamCache(key3)).not.toBeNull(); // staging untouched
  });

  it("is a no-op when the cluster has no cached entries", () => {
    setStreamCache(key3, sampleEntries, true);
    expect(() => clearStreamCacheForCluster("unknown-cluster")).not.toThrow();
    expect(getStreamCache(key3)).not.toBeNull();
  });
});

describe("clearAllStreamCache", () => {
  it("empties the entire cache", () => {
    setStreamCache(key1, sampleEntries, true);
    setStreamCache(key2, sampleEntries, true);
    setStreamCache(key3, sampleEntries, true);

    clearAllStreamCache();

    expect(streamCacheSize()).toBe(0);
    expect(getStreamCache(key1)).toBeNull();
    expect(getStreamCache(key2)).toBeNull();
    expect(getStreamCache(key3)).toBeNull();
  });
});

describe("streamCacheSize", () => {
  it("returns 0 on empty cache", () => {
    expect(streamCacheSize()).toBe(0);
  });

  it("increments as entries are added", () => {
    setStreamCache(key1, sampleEntries, true);
    expect(streamCacheSize()).toBe(1);
    setStreamCache(key2, sampleEntries, true);
    expect(streamCacheSize()).toBe(2);
  });

  it("decrements after clearStreamCacheForCluster", () => {
    setStreamCache(key1, sampleEntries, true);
    setStreamCache(key2, sampleEntries, true);
    setStreamCache(key3, sampleEntries, true);
    clearStreamCacheForCluster("prod");
    expect(streamCacheSize()).toBe(1);
  });
});
