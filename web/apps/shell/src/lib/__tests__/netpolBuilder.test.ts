import { describe, it, expect } from "vitest";
import { draftToPolicy, parseLabels, policyImpact, toYaml, type PolicyDraft } from "../netpolBuilder";

type Obj = Record<string, unknown>;

const base: PolicyDraft = { name: "db-lockdown", namespace: "shop", podLabels: "app=db", ingress: null, egress: null, allowDns: true };

function pod(name: string, labels: Record<string, string>, ns = "shop"): Obj {
  return { metadata: { name, namespace: ns, labels }, spec: { containers: [] }, status: { podIP: "10.0.0.1" } };
}

describe("parseLabels", () => {
  it("parses comma-separated key=value pairs, empty meaning every pod", () => {
    expect(parseLabels("app=web, tier=frontend")).toEqual({ ok: true, labels: { app: "web", tier: "frontend" } });
    expect(parseLabels("  ")).toEqual({ ok: true, labels: {} });
  });
  it("rejects a pair without a value", () => {
    expect(parseLabels("app")).toEqual({ ok: false, error: 'expected key=value, got "app"' });
  });
});

describe("draftToPolicy", () => {
  it("requires restricting at least one direction", () => {
    expect(draftToPolicy(base)).toEqual({ ok: false, error: "Restrict ingress, egress or both." });
  });

  it("builds a deny-all-ingress policy for the selected pods", () => {
    const r = draftToPolicy({ ...base, ingress: [] });
    expect(r).toEqual({
      ok: true,
      policy: {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: "db-lockdown", namespace: "shop" },
        spec: { podSelector: { matchLabels: { app: "db" } }, policyTypes: ["Ingress"], ingress: [] },
      },
    });
  });

  it("selects every pod in the namespace when no labels are given", () => {
    const r = draftToPolicy({ ...base, podLabels: "", ingress: [] });
    expect(r.ok && (r.policy.spec as Obj).podSelector).toEqual({});
  });

  it("turns each peer kind into the right from-entry, with optional ports", () => {
    const r = draftToPolicy({
      ...base,
      ingress: [
        { peer: { kind: "pods", labels: "app=api" }, ports: "8080" },
        { peer: { kind: "pods", namespace: "ops", labels: "app=prom" }, ports: "9090/TCP, 53/UDP" },
        { peer: { kind: "namespace", namespace: "ingress-nginx" }, ports: "" },
        { peer: { kind: "cidr", cidr: "10.1.0.0/16" }, ports: "" },
      ],
    });
    expect(r.ok && (r.policy.spec as Obj).ingress).toEqual([
      { from: [{ podSelector: { matchLabels: { app: "api" } } }], ports: [{ protocol: "TCP", port: 8080 }] },
      {
        from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "ops" } }, podSelector: { matchLabels: { app: "prom" } } }],
        ports: [{ protocol: "TCP", port: 9090 }, { protocol: "UDP", port: 53 }],
      },
      { from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "ingress-nginx" } } }] },
      { from: [{ ipBlock: { cidr: "10.1.0.0/16" } }] },
    ]);
  });

  it("adds a DNS egress rule when egress is restricted and DNS is allowed", () => {
    const r = draftToPolicy({ ...base, egress: [] });
    expect(r.ok && (r.policy.spec as Obj).egress).toEqual([
      {
        to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } }, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }],
        ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }],
      },
    ]);
    expect(r.ok && (r.policy.spec as Obj).policyTypes).toEqual(["Egress"]);
    const noDns = draftToPolicy({ ...base, egress: [], allowDns: false });
    expect(noDns.ok && (noDns.policy.spec as Obj).egress).toEqual([]);
  });

  it("reports bad input instead of building a broken policy", () => {
    expect(draftToPolicy({ ...base, name: "Bad Name", ingress: [] })).toEqual({ ok: false, error: "Name must be a lowercase DNS label." });
    expect(draftToPolicy({ ...base, ingress: [{ peer: { kind: "pods", labels: "" }, ports: "http" }] })).toEqual({
      ok: false,
      error: 'Bad port "http": use a number, optionally /TCP, /UDP or /SCTP.',
    });
    expect(draftToPolicy({ ...base, ingress: [{ peer: { kind: "cidr", cidr: "10.0.0.0" }, ports: "" }] })).toEqual({
      ok: false,
      error: 'Bad CIDR "10.0.0.0".',
    });
  });
});

describe("toYaml", () => {
  it("emits block YAML with quoted strings, nested maps, lists and empty collections", () => {
    expect(toYaml({ a: "x", b: 1, c: { d: [{ e: true }, "f"] }, g: [], h: {} })).toBe(
      ['a: "x"', "b: 1", "c:", "  d:", "    - e: true", '    - "f"', "g: []", "h: {}", ""].join("\n"),
    );
  });
  it("quotes keys that aren't plain", () => {
    expect(toYaml({ "kubernetes.io/metadata.name": "ops", "has space": 1 })).toBe('kubernetes.io/metadata.name: "ops"\n"has space": 1\n');
  });
});

describe("policyImpact", () => {
  const web = pod("web", { app: "web" });
  const api = pod("api", { app: "api" });
  const db = pod("db", { app: "db" });
  const ns = [{ metadata: { name: "shop" } }];

  it("lists newly isolated pods and the connections they would stop accepting", () => {
    const r = draftToPolicy({ ...base, ingress: [] });
    const impact = policyImpact({ policy: r.ok ? r.policy : {}, pods: [web, api, db], policies: [], namespaces: ns });
    expect(impact.isolated).toEqual(["shop/db (ingress)"]);
    expect(impact.blocked).toEqual(["shop/api → shop/db", "shop/web → shop/db"]);
    expect(impact.allowed).toEqual([]);
  });

  it("shows connections a policy opens on pods that were already isolated", () => {
    const existing = {
      metadata: { name: "only-web", namespace: "shop" },
      spec: { podSelector: { matchLabels: { app: "db" } }, policyTypes: ["Ingress"], ingress: [{ from: [{ podSelector: { matchLabels: { app: "web" } } }] }] },
    };
    const r = draftToPolicy({ ...base, ingress: [{ peer: { kind: "pods", labels: "app=api" }, ports: "" }] });
    const impact = policyImpact({ policy: r.ok ? r.policy : {}, pods: [web, api, db], policies: [existing], namespaces: ns });
    expect(impact.isolated).toEqual([]);
    expect(impact.blocked).toEqual([]);
    expect(impact.allowed).toEqual(["shop/api → shop/db"]);
  });

  it("notes when traffic stays allowed but only on some ports", () => {
    const r = draftToPolicy({ ...base, ingress: [{ peer: { kind: "pods", labels: "app=web" }, ports: "5432" }] });
    const impact = policyImpact({ policy: r.ok ? r.policy : {}, pods: [web, db], policies: [], namespaces: ns });
    expect(impact.narrowed).toEqual(["shop/web → shop/db (TCP/5432 only)"]);
    expect(impact.blocked).toEqual([]);
  });

  it("stops after maxPairs and says the list is partial", () => {
    const r = draftToPolicy({ ...base, ingress: [] });
    const impact = policyImpact({ policy: r.ok ? r.policy : {}, pods: [web, api, db], policies: [], namespaces: ns, maxPairs: 1 });
    expect(impact.truncated).toBe(true);
    expect(impact.blocked).toHaveLength(1);
    const full = policyImpact({ policy: r.ok ? r.policy : {}, pods: [web, api, db], policies: [], namespaces: ns });
    expect(full.truncated).toBe(false);
  });

  it("treats a same-named policy as replaced, not added alongside", () => {
    const old = {
      metadata: { name: "db-lockdown", namespace: "shop" },
      spec: { podSelector: { matchLabels: { app: "db" } }, policyTypes: ["Ingress"], ingress: [{ from: [{ podSelector: { matchLabels: { app: "api" } } }] }] },
    };
    // The old policy let api in; its replacement lets only web in, so api → db closes.
    const r = draftToPolicy({ ...base, ingress: [{ peer: { kind: "pods", labels: "app=web" }, ports: "" }] });
    const impact = policyImpact({ policy: r.ok ? r.policy : {}, pods: [web, api, db], policies: [old], namespaces: ns });
    expect(impact.blocked).toEqual(["shop/api → shop/db"]);
    expect(impact.allowed).toEqual(["shop/web → shop/db"]);
    expect(impact.isolated).toEqual([]);
  });

  it("also previews pods the replaced policy selected but the new one doesn't", () => {
    const old = {
      metadata: { name: "db-lockdown", namespace: "shop" },
      spec: { podSelector: { matchLabels: { app: "db" } }, policyTypes: ["Ingress"], ingress: [] },
    };
    // Same name, now selecting web: db is no longer locked down.
    const r = draftToPolicy({ ...base, podLabels: "app=web", ingress: [] });
    const impact = policyImpact({ policy: r.ok ? r.policy : {}, pods: [web, api, db], policies: [old], namespaces: ns });
    expect(impact.allowed).toEqual(["shop/api → shop/db", "shop/web → shop/db"]);
    expect(impact.blocked).toEqual(["shop/api → shop/web", "shop/db → shop/web"]);
  });
});
