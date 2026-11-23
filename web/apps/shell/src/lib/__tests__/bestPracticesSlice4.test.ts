import { describe, expect, it } from "vitest";
import { computeBestPractices, frameworkScores, type BestPracticeCheck, type BestPracticesInput } from "../bestPractices";
import { applyExceptions } from "../bestPracticesExceptions";
import { RESOURCE_TEMPLATES } from "../resourceTemplates";
import { automountFixYaml, defaultDenyYaml, fixFor, pdbYaml, podSecurityYaml, toYaml } from "../bestPracticesFixes";

type O = Record<string, unknown>;

function check(over: Partial<BestPracticeCheck>): BestPracticeCheck {
  return {
    id: "x",
    severity: "Medium",
    learn: { text: "", docsUrl: "" },
    group: "Security",
    title: "t",
    status: "pass",
    detail: "",
    why: "",
    ...over,
  };
}

describe("frameworkScores", () => {
  it("scores each pillar as pass over scored checks, and CIS-referenced checks on their own", () => {
    const scores = frameworkScores([
      check({ id: "a", group: "Security", status: "pass", reference: "CIS 5.2.2" }),
      check({ id: "b", group: "Security", status: "fail", reference: "CIS 5.3.2" }),
      check({ id: "c", group: "Security", status: "unknown" }),
      check({ id: "d", group: "Security", status: "ignored" }),
      check({ id: "e", group: "Reliability", status: "pass" }),
    ]);
    const by = Object.fromEntries(scores.map((s) => [s.framework, s]));
    expect(by.Security).toMatchObject({ pass: 1, scored: 3, ignored: 1, total: 4, score: 33 });
    expect(by.Reliability).toMatchObject({ pass: 1, scored: 1, score: 100 });
    expect(by["CIS-referenced"]).toMatchObject({ pass: 1, scored: 2, score: 50 });
  });

  it("lists the pillars in a fixed order and leaves out a framework with no checks", () => {
    const scores = frameworkScores([check({ group: "Platform" }), check({ id: "s", group: "Security" })]);
    expect(scores.map((s) => s.framework)).toEqual(["Security", "Platform"]);
  });

  it("gives no score (null) when every check of a framework is ignored", () => {
    const [s] = frameworkScores([check({ group: "Disaster recovery", status: "ignored" })]);
    expect(s).toMatchObject({ framework: "Disaster recovery", scored: 0, score: null });
  });
});

describe("toYaml", () => {
  it("quotes every string, so a name like 123 or true stays a string", () => {
    expect(toYaml({ metadata: { name: "123", labels: { "app.kubernetes.io/name": "true" } }, spec: { count: 1, b: false, l: ["a"] } })).toBe(
      ["metadata:", '  name: "123"', "  labels:", '    "app.kubernetes.io/name": "true"', "spec:", "  count: 1", "  b: false", "  l:", '    - "a"', ""].join("\n"),
    );
  });
  it("writes empty objects and arrays inline", () => {
    expect(toYaml({ spec: { podSelector: {}, ingress: [] } })).toBe(["spec:", "  podSelector: {}", "  ingress: []", ""].join("\n"));
  });
  it("quotes a key YAML 1.1 would read as a boolean", () => {
    expect(toYaml({ on: "x" })).toBe('"on": "x"\n');
  });
  it("writes a list of objects", () => {
    expect(toYaml({ e: [{ key: "a", values: ["b"] }] })).toBe(["e:", '  - key: "a"', "    values:", '      - "b"', ""].join("\n"));
  });
});

describe("fix YAML generators", () => {
  it("pdbYaml copies the workload's selector and allows one pod down", () => {
    const y = pdbYaml({ ns: "shop", name: "web", selector: { matchLabels: { app: "web" } } });
    expect(y).toContain("apiVersion: policy/v1\nkind: PodDisruptionBudget\n");
    expect(y).toContain('  name: "web-pdb"\n  namespace: "shop"\n');
    expect(y).toContain('  maxUnavailable: 1\n  selector:\n    matchLabels:\n      app: "web"\n');
  });
  it("defaultDenyYaml denies ingress to every pod in the namespace", () => {
    const y = defaultDenyYaml("shop");
    expect(y).toContain("kind: NetworkPolicy");
    expect(y).toContain('  name: "default-deny-ingress"\n  namespace: "shop"\n');
    expect(y).toContain("  podSelector: {}\n  policyTypes:\n    - \"Ingress\"\n");
    expect(y).not.toContain("Egress");
  });
  it("podSecurityYaml enforces baseline and warns and audits on restricted", () => {
    const y = podSecurityYaml("shop");
    expect(y).toContain("kind: Namespace");
    expect(y).toContain('"pod-security.kubernetes.io/enforce": "baseline"');
    expect(y).toContain('"pod-security.kubernetes.io/warn": "restricted"');
    expect(y).toContain('"pod-security.kubernetes.io/audit": "restricted"');
  });
  it("automountFixYaml sets the field on the pod template of each workload kind", () => {
    expect(automountFixYaml("Deployment", "shop", "web")).toContain("apiVersion: apps/v1\nkind: Deployment\n");
    expect(automountFixYaml("Deployment", "shop", "web")).toContain("spec:\n  template:\n    spec:\n      automountServiceAccountToken: false\n");
    expect(automountFixYaml("CronJob", "jobs", "nightly")).toContain(
      "apiVersion: batch/v1\nkind: CronJob\n",
    );
    expect(automountFixYaml("CronJob", "jobs", "nightly")).toContain("  jobTemplate:\n    spec:\n      template:\n        spec:\n          automountServiceAccountToken: false\n");
  });
});

const tpl = (labels: O, pod: O = {}) => ({ metadata: { labels }, spec: { containers: [{ name: "c", image: "nginx:1" }], ...pod } });
const dep = (ns: string, name: string, replicas = 2, pod: O = {}): O => ({
  metadata: { namespace: ns, name },
  spec: { replicas, selector: { matchLabels: { app: name } }, template: tpl({ app: name }, pod) },
});
function base(over: Partial<BestPracticesInput> = {}): BestPracticesInput {
  return { deployments: [], statefulsets: [], pdbs: [], networkPolicies: [], namespaces: [], ingressClasses: [], apiGroups: [], ...over };
}
const get = (i: BestPracticesInput, id: string, ex = [] as Parameters<typeof applyExceptions>[1]) =>
  applyExceptions(computeBestPractices(i), ex).find((c) => c.id === id)!;
const docs = (y: string) => y.split("\n---\n");

describe("fixFor", () => {
  it("opens the editor on a kind the Create Resource picker has, so the picker matches the YAML", () => {
    const kinds = RESOURCE_TEMPLATES.map((t) => t.kind);
    for (const k of ["PodDisruptionBudget", "NetworkPolicy", "Namespace", "Deployment", "StatefulSet", "DaemonSet", "CronJob"]) expect(kinds).toContain(k);
  });

  it("offers a PodDisruptionBudget for each multi-replica workload without one, every document carrying apiVersion", () => {
    const input = base({ deployments: [dep("shop", "web"), dep("shop", "api"), dep("shop", "solo", 1)] });
    const fix = fixFor(get(input, "pdb"), input)!;
    expect(fix.kind).toBe("PodDisruptionBudget");
    expect(fix.count).toBe(2);
    const d = docs(fix.yaml);
    expect(d).toHaveLength(2);
    for (const doc of d) expect(doc).toMatch(/^(#.*\n)*apiVersion: policy\/v1\n/);
    expect(fix.yaml).toContain('name: "web-pdb"');
    expect(fix.yaml).not.toContain("solo");
    expect(fix.yaml).toMatch(/^# /);
  });

  it("skips offenders a namespace exception removed", () => {
    const input = base({ deployments: [dep("shop", "web"), dep("dev", "api")] });
    const fix = fixFor(get(input, "pdb", [{ checkId: "pdb", namespace: "dev", reason: "r", createdAt: 0 }]), input)!;
    expect(fix.count).toBe(1);
    expect(fix.yaml).not.toContain('"dev"');
  });

  it("offers a default-deny NetworkPolicy per namespace without one", () => {
    const input = base({ deployments: [dep("shop", "web")], namespaces: [{ metadata: { name: "shop" } }] });
    const fix = fixFor(get(input, "network-policies"), input)!;
    expect(fix).toMatchObject({ kind: "NetworkPolicy", count: 1 });
    expect(fix.yaml).toContain('namespace: "shop"');
  });

  it("offers Pod Security labels per namespace without an enforce label", () => {
    const input = base({ namespaces: [{ metadata: { name: "shop" } }, { metadata: { name: "ok", labels: { "pod-security.kubernetes.io/enforce": "restricted" } } }] });
    const fix = fixFor(get(input, "pod-security"), input)!;
    expect(fix).toMatchObject({ kind: "Namespace", count: 1 });
    expect(fix.yaml).toContain('name: "shop"');
    expect(fix.yaml).not.toContain('name: "ok"');
  });

  it("sets automountServiceAccountToken: false on each offending controller, and leaves bare pods out with a note", () => {
    const input = base({
      deployments: [dep("shop", "web", 1), dep("shop", "own", 1, { serviceAccountName: "web-sa" })],
      cronjobs: [{ metadata: { namespace: "jobs", name: "nightly" }, spec: { jobTemplate: { spec: { template: tpl({}) } } } }],
      pods: [{ metadata: { namespace: "dev", name: "lone" }, spec: { containers: [{ name: "c" }] } }],
    });
    const fix = fixFor(get(input, "sa-automount"), input)!;
    expect(fix.count).toBe(2);
    expect(fix.yaml).toContain("kind: Deployment");
    expect(fix.yaml).toContain("kind: CronJob");
    expect(fix.yaml).not.toContain('"own"');
    expect(fix.yaml).not.toContain('name: "lone"');
    expect(fix.yaml).toMatch(/bare pod/i);
  });

  it("offers nothing for a passing, unknown or ignored check, or a check with no safe fix", () => {
    const input = base({ deployments: [dep("shop", "web")] });
    expect(fixFor(get(base(), "pdb"), base())).toBeUndefined();
    expect(fixFor(get(base({ pdbs: undefined }), "pdb"), base())).toBeUndefined();
    expect(fixFor(get(input, "pdb", [{ checkId: "pdb", reason: "r", createdAt: 0 }]), input)).toBeUndefined();
    const priv = base({ deployments: [dep("shop", "p", 1, { containers: [{ name: "c", securityContext: { privileged: true } }] })] });
    expect(fixFor(get(priv, "privileged"), priv)).toBeUndefined();
  });
});
