import { describe, it, expect } from "vitest";
import { podCpuQueries, podMemQueries, firstWithSeries } from "../podPromQueries";

describe("pod graph queries", () => {
  it("tries the current label names first, without requiring an image label", () => {
    const [first] = podCpuQueries("shop", "web-1");
    expect(first).toContain('namespace="shop"');
    expect(first).toContain('pod="web-1"');
    expect(first).toContain('container!=""');
    expect(first).not.toContain("image");
  });

  it("then the older pod_name/container_name labels, renamed so the chart reads them", () => {
    const q = podMemQueries("shop", "web-1")[1]!;
    expect(q).toContain('pod_name="web-1"');
    expect(q).toContain("container_name");
    expect(q).toContain("label_replace");
  });

  it("falls back to the pod total when no series carries a container label", () => {
    const last = podCpuQueries("shop", "web-1").at(-1)!;
    expect(last).toContain('pod="web-1"');
    expect(last).not.toContain("container!=");
  });

  it("stops at the first query that returns series, and reports which one", async () => {
    const calls: string[] = [];
    const out = await firstWithSeries(["a", "b", "c"], async (q) => {
      calls.push(q);
      return { data: { result: q === "b" ? [{ metric: {}, values: [] as [number, string][] }] : [] } };
    });
    expect(calls).toEqual(["a", "b"]);
    expect(out.data.result).toHaveLength(1);
  });

  it("returns the empty answer when no query has series", async () => {
    const out = await firstWithSeries(["a", "b"], async () => ({ data: { result: [] } }));
    expect(out.data.result).toEqual([]);
  });

  it("lets an error from the first query through, so the cause is shown", async () => {
    await expect(firstWithSeries(["a", "b"], async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});
