import { describe, expect, it } from "vitest";
import { compareErrorMessage, refFromObject, refFromRowKey, normalizeObject, refLabel, sameRef, toYaml, unifiedDiff } from "../compare";

const deploy = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: {
    name: "api",
    namespace: "shop",
    uid: "u-1",
    resourceVersion: "42",
    generation: 7,
    creationTimestamp: "2026-01-01T00:00:00Z",
    managedFields: [{ manager: "kubectl" }],
    selfLink: "/x",
    labels: { app: "api" },
    annotations: { "kubectl.kubernetes.io/last-applied-configuration": "{...}", team: "pay" },
  },
  spec: { replicas: 2 },
  status: { readyReplicas: 2 },
};

describe("normalizeObject", () => {
  it("strips the noise by default, keeping everything else", () => {
    const n = normalizeObject(deploy, true) as any;
    expect(n.status).toBeUndefined();
    for (const k of ["uid", "resourceVersion", "generation", "creationTimestamp", "managedFields", "selfLink"]) {
      expect(n.metadata[k]).toBeUndefined();
    }
    expect(n.metadata.annotations).toEqual({ team: "pay" });
    expect(n.metadata.labels).toEqual({ app: "api" });
    expect(n.spec).toEqual({ replicas: 2 });
  });
  it("drops an annotations map the strip leaves empty", () => {
    const n = normalizeObject({ metadata: { annotations: { "kubectl.kubernetes.io/last-applied-configuration": "x" } } }, true) as any;
    expect(n.metadata.annotations).toBeUndefined();
  });
  it("keeps everything when noise is shown, and never mutates its input", () => {
    const n = normalizeObject(deploy, false) as any;
    expect(n.metadata.uid).toBe("u-1");
    expect(n.status).toEqual({ readyReplicas: 2 });
    normalizeObject(deploy, true);
    expect(deploy.metadata.uid).toBe("u-1");
  });
});

describe("toYaml", () => {
  it("sorts keys so the same object always gives the same text", () => {
    expect(toYaml({ b: 1, a: { d: true, c: null } })).toBe("a:\n  c: null\n  d: true\nb: 1\n");
  });
  it("writes lists, nested lists of maps and empty containers", () => {
    expect(toYaml({ l: [{ a: 1, b: 2 }, "x"], e: [], m: {} })).toBe("e: []\nl:\n  - a: 1\n    b: 2\n  - x\nm: {}\n");
  });
  it("quotes strings YAML would read as something else", () => {
    const t = toYaml({ a: "true", b: "12", c: "", d: "a: b", e: "plain", f: "line1\nline2", g: "<7 bytes>" });
    expect(t).toContain('a: "true"');
    expect(t).toContain('b: "12"');
    expect(t).toContain('c: ""');
    expect(t).toContain('d: "a: b"');
    expect(t).toContain("e: plain");
    expect(t).toContain('f: "line1\\nline2"');
    expect(t).toContain('g: "<7 bytes>"');
  });
});

describe("unifiedDiff", () => {
  it("is empty when the sides are equal", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", "L", "R")).toBe("");
  });
  it("writes headers, hunks with context and +/- lines", () => {
    const a = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].join("\n") + "\n";
    const b = ["1", "2", "3", "4", "five", "6", "7", "8", "9", "10"].join("\n") + "\n";
    const d = unifiedDiff(a, b, "dev/api", "prod/api");
    expect(d).toBe(
      ["--- dev/api", "+++ prod/api", "@@ -2,7 +2,7 @@", " 2", " 3", " 4", "-5", "+five", " 6", " 7", " 8", ""].join("\n"),
    );
  });
  it("handles pure additions and removals", () => {
    const d = unifiedDiff("a\n", "a\nb\n", "L", "R");
    expect(d).toContain("+b");
    expect(unifiedDiff("a\nb\n", "a\n", "L", "R")).toContain("-b");
  });
});

describe("refs and errors", () => {
  const r = { cluster: "dev", gvr: "apps/v1/deployments", ns: "shop", name: "api" };
  it("labels a ref with cluster, namespace and name", () => {
    expect(refLabel(r)).toBe("dev: shop/api");
    expect(refLabel({ ...r, ns: "" })).toBe("dev: api");
  });
  it("tells whether two refs are the same object", () => {
    expect(sameRef(r, { ...r })).toBe(true);
    expect(sameRef(r, { ...r, cluster: "prod" })).toBe(false);
  });
  it("says forbidden clearly, and keeps the API server's reason", () => {
    const m = compareErrorMessage(new Error('get: deployments.apps "api" is forbidden: User "x" cannot get'), r);
    expect(m).toMatch(/not allowed to read/i);
    expect(m).toContain("dev: shop/api");
  });
  it("says not found and unreachable", () => {
    expect(compareErrorMessage(Object.assign(new Error("x"), { name: "ObjectNotFoundError" }), r)).toMatch(/not found/i);
    expect(compareErrorMessage(new Error("get: dial tcp: i/o timeout"), r)).toContain("Could not read");
  });
});

describe("making refs", () => {
  it("resolves a built-in kind's search hit to its gvr", () => {
    expect(refFromObject({ cluster: "dev", slug: "deployments", ns: "shop", name: "api" })).toEqual({
      cluster: "dev",
      gvr: "apps/v1/deployments",
      ns: "shop",
      name: "api",
      kind: "Deployment",
    });
  });
  it("resolves a custom resource hit by its ext-- slug, and cluster-scoped ones have no namespace", () => {
    const r = refFromObject({ cluster: "dev", slug: "ext--karpenter.sh--v1--nodepools", ns: "", name: "np", clusterScoped: true });
    expect(r?.gvr).toBe("karpenter.sh/v1/nodepools");
    expect(r?.ns).toBe("");
  });
  it("gives null for a kind it cannot resolve", () => {
    expect(refFromObject({ cluster: "dev", slug: "nope", ns: "", name: "x" })).toBeNull();
  });
  it("splits a table row key into a ref", () => {
    expect(refFromRowKey("shop/api", "dev", "apps/v1/deployments", "Deployment")).toEqual({
      cluster: "dev",
      gvr: "apps/v1/deployments",
      ns: "shop",
      name: "api",
      kind: "Deployment",
    });
    expect(refFromRowKey("/node-1", "dev", "v1/nodes").ns).toBe("");
  });
});
