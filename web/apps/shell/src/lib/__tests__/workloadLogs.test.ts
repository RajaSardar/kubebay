import { describe, expect, it } from "vitest";
import { MAX_LOG_PODS, logPodMatches, pickLogPods } from "../workloadLogs";

// Backlog 59 and 61: which pods of a workload the merged log view follows.
const row = (name: string, status = "running") => ({ name, status, containers: ["app", "side"] }) as never;

describe("pickLogPods", () => {
  it("takes every pod when there are few, running ones first, then by name", () => {
    const r = pickLogPods([row("b", "failed"), row("c"), row("a")]);
    expect(r.pods.map((p) => p.name)).toEqual(["a", "c", "b"]);
    expect(r.total).toBe(3);
  });

  it("caps the pods and says how many there were", () => {
    const many = Array.from({ length: MAX_LOG_PODS + 7 }, (_, i) => row(`p-${String(i).padStart(3, "0")}`));
    const r = pickLogPods(many);
    expect(r.pods).toHaveLength(MAX_LOG_PODS);
    expect(r.total).toBe(MAX_LOG_PODS + 7);
  });
});

describe("logPodMatches", () => {
  it("matches a part of a name, or the whole name when quoted or after =", () => {
    expect(logPodMatches("web-7d9f8c6b5d-x2k4q", "x2k4")).toBe(true);
    expect(logPodMatches("web-7d9f8c6b5d-x2k4q", '"x2k4"')).toBe(false);
    expect(logPodMatches("web-7d9f8c6b5d-x2k4q", "=web-7d9f8c6b5d-x2k4q")).toBe(true);
    expect(logPodMatches("web-7d9f8c6b5d-x2k4q", "")).toBe(true);
  });
});
