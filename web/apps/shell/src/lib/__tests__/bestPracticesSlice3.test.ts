import { beforeEach, describe, expect, it } from "vitest";
import { computeBestPractices, summarize, workloadCoverage, type BestPracticesInput } from "../bestPractices";
import { applyExceptions, loadExceptions, saveExceptions, type BpException } from "../bestPracticesExceptions";
import { reportToJSON, reportToMarkdown } from "../bestPracticesReport";

type O = Record<string, unknown>;
const priv = { name: "c", image: "nginx:1", securityContext: { privileged: true } };
const tpl = (c: O) => ({ metadata: { labels: { app: "x" } }, spec: { containers: [c] } });
const deployment = (ns: string, name: string, c: O = priv): O => ({ metadata: { namespace: ns, name }, spec: { replicas: 1, template: tpl(c) } });
const daemonset = (ns: string, name: string, c: O = priv): O => ({ metadata: { namespace: ns, name }, spec: { template: tpl(c) } });
const cronjob = (ns: string, name: string, c: O = priv): O => ({ metadata: { namespace: ns, name }, spec: { jobTemplate: { spec: { template: tpl(c) } } } });
const pod = (ns: string, name: string, c: O = priv, owner = false): O => ({
  metadata: { namespace: ns, name, ...(owner ? { ownerReferences: [{ kind: "ReplicaSet", controller: true }] } : {}) },
  spec: { containers: [c] },
});

function base(over: Partial<BestPracticesInput> = {}): BestPracticesInput {
  return { deployments: [], statefulsets: [], pdbs: [], networkPolicies: [], namespaces: [], ingressClasses: [], apiGroups: [], ...over };
}
const get = (i: BestPracticesInput, id: string) => computeBestPractices(i).find((c) => c.id === id)!;

describe("coverage of DaemonSets, CronJobs and bare Pods", () => {
  it("reads the pod templates of DaemonSets and CronJobs", () => {
    const r = get(base({ daemonsets: [daemonset("ops", "agent")], cronjobs: [cronjob("jobs", "nightly")] }), "privileged");
    expect(r.status).toBe("fail");
    expect(r.allOffenders).toEqual(["ops/agent", "jobs/nightly"]);
  });
  it("reads bare pods but skips pods owned by a controller", () => {
    const r = get(base({ pods: [pod("dev", "lone"), pod("dev", "owned", priv, true)] }), "privileged");
    expect(r.allOffenders).toEqual(["dev/lone"]);
  });
  it("leaves system namespaces out", () => {
    expect(get(base({ daemonsets: [daemonset("kube-system", "proxy")] }), "privileged").status).toBe("pass");
  });
  it("counts what was covered and says what could not be read", () => {
    const cov = workloadCoverage(
      base({ deployments: [deployment("a", "d")], daemonsets: [daemonset("a", "ds"), daemonset("kube-system", "p")], pods: [pod("a", "p1"), pod("a", "p2", priv, true)] }),
    );
    const by = Object.fromEntries(cov.map((c) => [c.kind, c]));
    expect(by.Deployments).toMatchObject({ count: 1, read: true });
    expect(by.DaemonSets).toMatchObject({ count: 1, read: true });
    expect(by["bare Pods"]).toMatchObject({ count: 1, read: true });
    expect(by.CronJobs).toMatchObject({ count: 0, read: false });
  });
});

describe("exceptions", () => {
  beforeEach(() => localStorage.clear());
  const checks = () => computeBestPractices(base({ deployments: [deployment("a", "one"), deployment("b", "two")] }));
  const ex = (e: Partial<BpException>): BpException => ({ checkId: "privileged", reason: "agent needs it", createdAt: 0, ...e });

  it("ignoring a check marks it Ignored with its reason, never a pass", () => {
    const c = applyExceptions(checks(), [ex({})]).find((x) => x.id === "privileged")!;
    expect(c.status).toBe("ignored");
    expect(c.exceptions).toEqual([{ reason: "agent needs it" }]);
  });
  it("ignoring one namespace removes only its offenders", () => {
    const c = applyExceptions(checks(), [ex({ namespace: "a" })]).find((x) => x.id === "privileged")!;
    expect(c.status).toBe("fail");
    expect(c.allOffenders).toEqual(["b/two"]);
    expect(c.detail).toMatch(/^1 /);
    expect(c.exceptions).toEqual([{ namespace: "a", reason: "agent needs it" }]);
  });
  it("ignoring every offending namespace makes the check Ignored", () => {
    const c = applyExceptions(checks(), [ex({ namespace: "a" }), ex({ namespace: "b" })]).find((x) => x.id === "privileged")!;
    expect(c.status).toBe("ignored");
  });
  it("exposes the namespaces a failing check can be ignored for", () => {
    expect(get(base({ deployments: [deployment("a", "one"), deployment("b", "two")] }), "privileged").namespaces).toEqual(["a", "b"]);
    expect(get(base({ nodes: [{ metadata: { name: "n1" }, status: {} }] }), "nodes-ready").namespaces).toBeUndefined();
  });
  it("excludes ignored checks from the score and counts them", () => {
    const s = summarize(applyExceptions(checks(), [ex({})]));
    expect(s.ignored).toBe(1);
    expect(s.pass + s.fail + s.unknown + s.ignored).toBe(s.total);
    expect(s.score).toBe(Math.round((s.pass / (s.total - 1)) * 100));
    expect(s.failedBySeverity.Critical).toBe(summarize(checks()).failedBySeverity.Critical - 1);
  });
  it("persists per cluster and survives bad data", () => {
    saveExceptions("c1", [ex({})]);
    expect(loadExceptions("c1")).toHaveLength(1);
    expect(loadExceptions("c2")).toEqual([]);
    localStorage.setItem("kb.bestPractices.exceptions.c3", "{nope");
    expect(loadExceptions("c3")).toEqual([]);
    saveExceptions("c1", []);
    expect(loadExceptions("c1")).toEqual([]);
  });
});

describe("CIS reference tags", () => {
  it("tags only well-known mappings, and leaves the rest without", () => {
    const m = Object.fromEntries(computeBestPractices(base()).map((c) => [c.id, c.reference]));
    expect(m["privileged"]).toBe("CIS 5.2.2");
    expect(m["runs-as-root"]).toBe("CIS 5.2.7");
    expect(m["network-policies"]).toBe("CIS 5.3.2");
    expect(m["sa-automount"]).toBe("CIS 5.1.6");
    expect(m["latest-tag"]).toBeUndefined();
    expect(m["pod-security"]).toBeUndefined();
  });
});

describe("export", () => {
  const input = base({ deployments: [deployment("a", "one")], daemonsets: [] });
  const cs = applyExceptions(computeBestPractices(input), [{ checkId: "runs-as-root", reason: "legacy", createdAt: 0 }]);
  const args = { cluster: "kind-dev", generatedAt: "2026-01-01T00:00:00.000Z", checks: cs, coverage: workloadCoverage(input) };
  it("JSON carries summary, coverage, checks, reference and ignore reasons", () => {
    const j = JSON.parse(reportToJSON(args));
    expect(j.cluster).toBe("kind-dev");
    expect(j.summary.ignored).toBe(1);
    expect(j.coverage.find((c: O) => c.kind === "DaemonSets").count).toBe(0);
    const root = j.checks.find((c: O) => c.id === "runs-as-root");
    expect(root.status).toBe("ignored");
    expect(root.exceptions[0].reason).toBe("legacy");
    expect(j.checks.find((c: O) => c.id === "privileged").reference).toBe("CIS 5.2.2");
  });
  it("Markdown lists checks with status, severity and ignore reasons", () => {
    const md = reportToMarkdown(args);
    expect(md).toContain("# Best practices: kind-dev");
    expect(md).toContain("Ignored");
    expect(md).toContain("legacy");
    expect(md).toContain("CIS 5.2.2");
  });
});
