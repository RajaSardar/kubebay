import { describe, expect, it } from "vitest";
import { podsPerNode, usageByName } from "../useNodeExtras";

// The Nodes table's extra data (metrics and pods per node), moved out of
// ResourceTable into a hook. Slice 6 of docs/TABLE_UNIFICATION.md.
describe("node extras", () => {
  it("counts pods per node, skipping unscheduled pods", () => {
    const pods = [
      { spec: { nodeName: "a" } },
      { spec: { nodeName: "b" } },
      { spec: { nodeName: "a" } },
      { spec: {} },
      {},
    ];
    const m = podsPerNode(pods);
    expect(m.get("a")).toBe(2);
    expect(m.get("b")).toBe(1);
    expect(m.size).toBe(2);
  });

  it("indexes node metrics by name", () => {
    const m = usageByName([{ name: "a", cpuMillis: 250, memBytes: 1024 }]);
    expect(m.get("a")).toEqual({ name: "a", cpuMillis: 250, memBytes: 1024 });
    expect(usageByName(undefined).size).toBe(0);
  });
});
