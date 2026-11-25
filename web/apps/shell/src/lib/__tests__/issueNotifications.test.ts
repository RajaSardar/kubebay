import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFY_SETTINGS,
  clickTarget,
  createIssueNotifier,
  loadNotifySettings,
  saveNotifySettings,
  type IssueNotification,
  type NotifySettings,
} from "../issueNotifications";
import type { Issue, IssueSeverity } from "../issues";

function issue(name: string, severity: IssueSeverity = "critical", kind = "Pod", namespace = "prod"): Issue {
  return {
    id: `pod-problem|${kind}|${namespace}|${name}|CrashLoopBackOff`,
    cluster: "c1",
    detector: "pod-problem",
    code: "CrashLoopBackOff",
    severity,
    kind,
    namespace,
    name,
    summary: "log line: password=hunter2",
    blast: 1,
    evidence: { open: "route", path: "/pods" },
  };
}

const on: NotifySettings = { ...DEFAULT_NOTIFY_SETTINGS, enabled: true };

function setup(settings: NotifySettings = on) {
  let t = 1_000_000;
  const n = createIssueNotifier(() => t);
  const obs = (issues: Issue[], o: { loading?: boolean; focused?: boolean; cluster?: string; s?: NotifySettings } = {}) =>
    n.observe({ cluster: o.cluster ?? "c1", issues, loading: o.loading ?? false, focused: o.focused ?? false, settings: o.s ?? settings });
  return { obs, n, advance: (ms: number) => (t += ms) };
}

describe("defaults", () => {
  it("are off, critical only, nothing muted", () => {
    expect(DEFAULT_NOTIFY_SETTINGS).toEqual({ enabled: false, minSeverity: "critical", mutedClusters: [] });
  });
  it("round-trip through storage and survive junk", () => {
    localStorage.clear();
    expect(loadNotifySettings()).toEqual(DEFAULT_NOTIFY_SETTINGS);
    saveNotifySettings({ enabled: true, minSeverity: "high", mutedClusters: ["a"] });
    expect(loadNotifySettings()).toEqual({ enabled: true, minSeverity: "high", mutedClusters: ["a"] });
    localStorage.setItem("kb.issueNotifications", '{"enabled":"yes","minSeverity":"loud","mutedClusters":[1]}');
    expect(loadNotifySettings()).toEqual(DEFAULT_NOTIFY_SETTINGS);
    localStorage.setItem("kb.issueNotifications", "not json");
    expect(loadNotifySettings()).toEqual(DEFAULT_NOTIFY_SETTINGS);
  });
});

describe("baseline", () => {
  it("never notifies for issues present while the app starts, even ones that arrive during loading", () => {
    const { obs } = setup();
    expect(obs([issue("a")], { loading: true })).toEqual([]);
    expect(obs([issue("a"), issue("b")], { loading: true })).toEqual([]);
    expect(obs([issue("a"), issue("b")])).toEqual([]);
    expect(obs([issue("a"), issue("b")])).toEqual([]);
  });
  it("notifies for a new issue after the baseline", () => {
    const { obs } = setup();
    obs([issue("a")]);
    const out = obs([issue("a"), issue("b")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Critical issue");
    expect(out[0]!.body).toBe("Pod prod/b");
    expect(out[0]!.issueId).toBe(issue("b").id);
  });
  it("re-baselines when the cluster changes", () => {
    const { obs } = setup();
    obs([issue("a")]);
    obs([issue("x")], { cluster: "c2", loading: true });
    expect(obs([issue("x")], { cluster: "c2" })).toEqual([]);
    expect(obs([issue("x"), issue("y")], { cluster: "c2" })).toHaveLength(1);
    // back on c1: its old known set is gone, so the baseline is taken again
    expect(obs([issue("a"), issue("z")], { cluster: "c1", loading: true })).toEqual([]);
    expect(obs([issue("a"), issue("z")], { cluster: "c1" })).toEqual([]);
  });
  it("does not notify for issues that appeared while notifications were off", () => {
    const { obs } = setup();
    obs([], { s: DEFAULT_NOTIFY_SETTINGS });
    obs([issue("a")], { s: DEFAULT_NOTIFY_SETTINGS });
    expect(obs([issue("a")])).toEqual([]);
  });
});

describe("filters", () => {
  it("does nothing when off", () => {
    const { obs } = setup();
    obs([], { s: DEFAULT_NOTIFY_SETTINGS });
    expect(obs([issue("a")], { s: DEFAULT_NOTIFY_SETTINGS })).toEqual([]);
  });
  it("applies the severity threshold", () => {
    const { obs } = setup();
    obs([]);
    expect(obs([issue("h", "high"), issue("m", "medium")])).toEqual([]);
    const { obs: obs2 } = setup({ ...on, minSeverity: "high" });
    obs2([]);
    const out = obs2([issue("h", "high"), issue("m", "medium"), issue("c", "critical")]);
    expect(out.map((o) => o.issueId)).toEqual([issue("c").id, issue("h", "high").id]);
    expect(out[1]!.title).toBe("High issue");
  });
  it("stays quiet for a muted cluster", () => {
    const { obs } = setup({ ...on, mutedClusters: ["c1"] });
    obs([]);
    expect(obs([issue("a")])).toEqual([]);
  });
  it("stays quiet while the window is focused, and does not replay later", () => {
    const { obs } = setup();
    obs([]);
    expect(obs([issue("a")], { focused: true })).toEqual([]);
    expect(obs([issue("a")])).toEqual([]);
  });
});

describe("dedupe and rate limit", () => {
  it("notifies once per issue per 6 hours", () => {
    const { obs, advance } = setup();
    obs([]);
    expect(obs([issue("a")])).toHaveLength(1);
    advance(60_000);
    obs([]); // resolved
    advance(60_000);
    expect(obs([issue("a")])).toEqual([]); // back within 6h
    obs([]);
    advance(6 * 3600_000);
    expect(obs([issue("a")])).toHaveLength(1);
  });
  it("sends 3 then one summary for the rest", () => {
    const { obs } = setup();
    obs([]);
    const five = ["a", "b", "c", "d", "e"].map((n) => issue(n));
    const out = obs(five);
    expect(out).toHaveLength(4);
    expect(out.slice(0, 3).every((o) => o.issueId)).toBe(true);
    expect(out[3]).toMatchObject({ title: "2 new issues", body: "Open Kubebay to see them." });
    expect(out[3]!.issueId).toBeUndefined();
  });
  it("counts the minute window across observations and refills after it", () => {
    const { obs, advance } = setup();
    obs([]);
    expect(obs([issue("a"), issue("b")])).toHaveLength(2);
    advance(10_000);
    const out = obs([issue("a"), issue("b"), issue("c"), issue("d")]);
    expect(out).toHaveLength(2); // one more single, then one summary
    expect(out[1]!.title).toBe("1 new issue");
    advance(61_000);
    expect(obs([issue("a"), issue("b"), issue("c"), issue("d"), issue("e")])).toHaveLength(1);
  });
  it("holds the rest while the summary is itself rate limited, then sends them", () => {
    const { obs, advance } = setup();
    obs([]);
    const first = obs(["a", "b", "c", "d", "e"].map((n) => issue(n)));
    expect(first).toHaveLength(4);
    advance(5_000);
    const all = ["a", "b", "c", "d", "e", "f", "g"].map((n) => issue(n));
    expect(obs(all)).toEqual([]);
    advance(61_000);
    const out = obs(all);
    expect(out.map((o) => o.issueId)).toEqual([issue("f").id, issue("g").id]);
  });
  it("drops held issues that resolve", () => {
    const { obs, advance } = setup();
    obs([]);
    obs(["a", "b", "c", "d", "e"].map((n) => issue(n)));
    advance(5_000);
    obs(["a", "b", "c", "d", "e", "f"].map((n) => issue(n)));
    advance(61_000);
    expect(obs([])).toEqual([]);
  });
});

describe("text", () => {
  it("carries only kind, namespace/name and severity, never the summary", () => {
    const { obs } = setup();
    obs([]);
    const [o] = obs([issue("a", "critical", "Node", "")]) as [IssueNotification];
    expect(o.body).toBe("Node a");
    expect(JSON.stringify(o)).not.toMatch(/hunter2|log line/);
  });
});

describe("clickTarget", () => {
  it("opens the issue only when focus follows a notification closely", () => {
    const sent = { at: 1000, issueId: "x" as string | undefined };
    expect(clickTarget(sent, 1000 + 30_000)).toBe("/issues?issue=x");
    expect(clickTarget(sent, 1000 + 130_000)).toBeNull();
    expect(clickTarget(null, 5)).toBeNull();
    expect(clickTarget({ at: 1000, issueId: undefined }, 2000)).toBe("/issues");
    expect(clickTarget({ at: 1, issueId: "a|b c" }, 2)).toBe("/issues?issue=a%7Cb%20c");
  });
});
