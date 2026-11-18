import { describe, expect, it } from "vitest";
import { stripItemState, protectedClusterIds } from "../clusterStripState";

describe("stripItemState", () => {
  it("active wins over everything", () => {
    expect(stripItemState({ active: true, streaming: true, sleeping: true })).toBe("active");
  });
  it("a streaming cluster is streaming", () => {
    expect(stripItemState({ streaming: true })).toBe("streaming");
  });
  it("an evicted cluster is sleeping, and not streaming", () => {
    expect(stripItemState({ sleeping: true })).toBe("sleeping");
    expect(stripItemState({ streaming: true, sleeping: true })).toBe("sleeping");
  });
  it("a never-connected cluster has no state", () => {
    expect(stripItemState({})).toBe("");
  });
});

describe("protectedClusterIds", () => {
  it("is the active cluster plus the pinned ones, once each", () => {
    const meta = { a: { pinned: true }, b: {}, c: { pinned: true } };
    expect(protectedClusterIds("c", meta).sort()).toEqual(["a", "c"]);
    expect(protectedClusterIds("b", meta).sort()).toEqual(["a", "b", "c"]);
  });
  it("ignores an empty active id", () => {
    expect(protectedClusterIds("", { a: { pinned: true } })).toEqual(["a"]);
  });
});
