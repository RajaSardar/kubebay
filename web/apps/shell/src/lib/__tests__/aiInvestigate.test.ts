import { describe, expect, it } from "vitest";
import { emptyRun, outcomeLabel, parseSse, reduceRun, requestFromIssue, requestFromObject } from "../aiInvestigate";
import type { Issue } from "../issues";

const issue: Issue = {
  id: "pod-problem|Pod|prod|web-1|CrashLoopBackOff",
  cluster: "c1",
  detector: "pod-problem",
  code: "CrashLoopBackOff",
  severity: "high",
  kind: "Pod",
  namespace: "prod",
  name: "web-1",
  summary: "Restarting every 30s",
  blast: 1,
  evidence: { open: "object", slug: "pods", ns: "prod", name: "web-1" },
};

describe("requestFromIssue", () => {
  it("sends the issue's own words and where it is, nothing else", () => {
    expect(requestFromIssue(issue)).toEqual({
      cluster: "c1",
      namespace: "prod",
      kind: "Pod",
      name: "web-1",
      issueId: issue.id,
      title: "Restarting every 30s",
      detail: "Needs attention: CrashLoopBackOff",
    });
  });
  it("leaves the namespace out for a cluster-scoped object", () => {
    expect(requestFromIssue({ ...issue, namespace: "", kind: "Node", name: "n1" }).namespace).toBeUndefined();
  });
});

describe("requestFromObject", () => {
  it("names the object and asks what is wrong with it", () => {
    const r = requestFromObject({ cluster: "c1", namespace: "prod", kind: "Deployment", name: "api" });
    expect(r).toMatchObject({ cluster: "c1", namespace: "prod", kind: "Deployment", name: "api" });
    expect(r.title).toContain("Deployment api");
  });
});

describe("parseSse", () => {
  it("returns whole events and keeps a partial one for the next chunk", () => {
    const a = parseSse('data: {"kind":"text","text":"hel"}\n\ndata: {"kind":"te');
    expect(a.events).toEqual([{ kind: "text", text: "hel" }]);
    const b = parseSse(a.rest + 'xt","text":"lo"}\n\n');
    expect(b.events).toEqual([{ kind: "text", text: "lo" }]);
    expect(b.rest).toBe("");
  });
  it("skips lines that are not data or not JSON", () => {
    expect(parseSse(": keepalive\n\ndata: nope\n\n").events).toEqual([]);
  });
});

describe("reduceRun", () => {
  it("accumulates text, tool names and notices, then the outcome", () => {
    let v = emptyRun();
    for (const e of [
      { kind: "text", text: "It is " },
      { kind: "tool", text: "mcp__kubebay__get_logs" },
      { kind: "text", text: "the image." },
      { kind: "notice", text: "Stopped: the output size limit was reached." },
      { kind: "end", text: "limit" },
    ] as const) {
      v = reduceRun(v, e);
    }
    expect(v).toEqual({ text: "It is the image.", tools: ["get_logs"], notices: ["Stopped: the output size limit was reached."], outcome: "limit", bytes: 16 });
  });
});

describe("outcomeLabel", () => {
  it("says plainly how it ended", () => {
    expect(outcomeLabel("done")).toBe("Finished");
    expect(outcomeLabel("stopped")).toBe("Stopped by you");
    expect(outcomeLabel("timeout")).toMatch(/time limit/);
    expect(outcomeLabel("limit")).toMatch(/size limit/);
    expect(outcomeLabel("error")).toMatch(/failed/i);
  });
});
