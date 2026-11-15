import { describe, it, expect } from "vitest";
import { evaluateConnection } from "../netpolEval";

type Obj = Record<string, unknown>;

const pod = (name: string, ns: string, labels: Record<string, string>, ip = "10.1.0.1", ports: Obj[] = []): Obj => ({
  metadata: { name, namespace: ns, labels },
  spec: { containers: [{ name: "c", ports }] },
  status: { podIP: ip },
});
const ns = (name: string, labels: Record<string, string> = {}): Obj => ({ metadata: { name, labels } });
const np = (name: string, namespace: string, spec: Obj): Obj => ({ metadata: { name, namespace }, spec });

const web = pod("web-1", "shop", { app: "web" }, "10.1.0.5");
const api = pod("api-1", "shop", { app: "api" }, "10.1.0.9", [{ name: "http", containerPort: 8080, protocol: "TCP" }]);
const other = pod("job-1", "batch", { app: "job" }, "10.2.0.3");
const namespaces = [ns("shop", { team: "shop" }), ns("batch", { team: "data" })];

const run = (policies: Obj[], src = web, dst = api, port?: { port: number; protocol?: string }) =>
  evaluateConnection({ src, dst, port, policies, namespaces });

describe("evaluateConnection", () => {
  it("allows everything when no policy selects either pod", () => {
    const v = run([np("unrelated", "shop", { podSelector: { matchLabels: { app: "db" } }, ingress: [] })]);
    expect(v.allowed).toBe(true);
    expect(v.ingress).toMatchObject({ isolated: false, allowed: true });
    expect(v.egress).toMatchObject({ isolated: false, allowed: true });
  });

  it("denies when the destination is selected by a default-deny ingress policy", () => {
    const v = run([np("deny-all", "shop", { podSelector: {}, policyTypes: ["Ingress"] })]);
    expect(v.allowed).toBe(false);
    expect(v.ingress).toEqual({ isolated: true, allowed: false, selectingPolicies: ["shop/deny-all"], allowingPolicies: [] });
  });

  it("isolates per pod, not per namespace", () => {
    const v = run([np("db-only", "shop", { podSelector: { matchLabels: { app: "db" } }, policyTypes: ["Ingress"] })]);
    expect(v.ingress.isolated).toBe(false);
    expect(v.allowed).toBe(true);
  });

  it("allows via a same-namespace podSelector peer, and names the allowing policy", () => {
    const v = run([
      np("deny-all", "shop", { podSelector: {}, policyTypes: ["Ingress"] }),
      np("web-to-api", "shop", { podSelector: { matchLabels: { app: "api" } }, ingress: [{ from: [{ podSelector: { matchLabels: { app: "web" } } }] }] }),
    ]);
    expect(v.allowed).toBe(true);
    expect(v.ingress.allowingPolicies).toEqual(["shop/web-to-api"]);
    expect(v.ingress.selectingPolicies).toEqual(["shop/deny-all", "shop/web-to-api"]);
  });

  it("does not let a bare podSelector peer match pods in another namespace", () => {
    const v = run([np("any-app", "shop", { podSelector: {}, ingress: [{ from: [{ podSelector: {} }] }] })], other, api);
    expect(v.allowed).toBe(false);
  });

  it("evaluates namespaceSelector against namespace labels, alone and combined with podSelector", () => {
    const nsOnly = [np("from-data", "shop", { podSelector: {}, ingress: [{ from: [{ namespaceSelector: { matchLabels: { team: "data" } } }] }] })];
    expect(run(nsOnly, other, api).allowed).toBe(true);
    expect(run(nsOnly, web, api).allowed).toBe(false);
    const both = [
      np("jobs-from-data", "shop", {
        podSelector: {},
        ingress: [{ from: [{ namespaceSelector: { matchLabels: { team: "data" } }, podSelector: { matchLabels: { app: "etl" } } }] }],
      }),
    ];
    expect(run(both, other, api).allowed).toBe(false);
  });

  it("matches the automatic kubernetes.io/metadata.name namespace label", () => {
    const v = run([np("from-batch", "shop", { podSelector: {}, ingress: [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "batch" } } }] }] })], other, api);
    expect(v.allowed).toBe(true);
  });

  it("honours matchExpressions in pod selectors", () => {
    const v = run([
      np("expr", "shop", {
        podSelector: { matchExpressions: [{ key: "app", operator: "In", values: ["api"] }] },
        ingress: [{ from: [{ podSelector: { matchExpressions: [{ key: "app", operator: "NotIn", values: ["web"] }] } }] }],
      }),
    ]);
    expect(v.ingress.isolated).toBe(true);
    expect(v.allowed).toBe(false);
  });

  it("checks ports by number and by the destination's named container port", () => {
    const policy = [np("api-8080", "shop", { podSelector: { matchLabels: { app: "api" } }, ingress: [{ from: [{ podSelector: {} }], ports: [{ port: 8080 }] }] })];
    expect(run(policy, web, api, { port: 8080 }).allowed).toBe(true);
    expect(run(policy, web, api, { port: 9090 }).allowed).toBe(false);
    const named = [np("api-http", "shop", { podSelector: { matchLabels: { app: "api" } }, ingress: [{ ports: [{ port: "http", protocol: "TCP" }] }] })];
    expect(run(named, web, api, { port: 8080 }).allowed).toBe(true);
    expect(run(named, web, api, { port: 8080, protocol: "UDP" }).allowed).toBe(false);
    const range = [np("range", "shop", { podSelector: { matchLabels: { app: "api" } }, ingress: [{ ports: [{ port: 8000, endPort: 8100 }] }] })];
    expect(run(range, web, api, { port: 8080 }).allowed).toBe(true);
  });

  it("reports port-restricted allows when no port is asked about", () => {
    const v = run([np("api-8080", "shop", { podSelector: { matchLabels: { app: "api" } }, ingress: [{ ports: [{ port: 8080 }] }] })]);
    expect(v.allowed).toBe(true);
    expect(v.ingress.allowedPorts).toEqual(["TCP/8080"]);
  });

  it("evaluates egress on the source side, including egress-only policies", () => {
    const denyEgress = [np("no-egress", "shop", { podSelector: { matchLabels: { app: "web" } }, policyTypes: ["Egress"] })];
    const v = run(denyEgress);
    expect(v.allowed).toBe(false);
    expect(v.egress).toMatchObject({ isolated: true, allowed: false, selectingPolicies: ["shop/no-egress"] });
    expect(v.ingress.isolated).toBe(false);
    const allowApi = [
      ...denyEgress,
      np("web-to-api", "shop", { podSelector: { matchLabels: { app: "web" } }, policyTypes: ["Egress"], egress: [{ to: [{ podSelector: { matchLabels: { app: "api" } } }] }] }),
    ];
    expect(run(allowApi).allowed).toBe(true);
  });

  it("treats a policy with an egress section and no policyTypes as affecting both directions", () => {
    const v = run([np("both", "shop", { podSelector: { matchLabels: { app: "web" } }, egress: [] })]);
    expect(v.egress.isolated).toBe(true);
    expect(v.allowed).toBe(false);
  });

  it("matches ipBlock peers against the pod IP, honouring except", () => {
    const policy = (except: string[] = []) => [
      np("cidr", "shop", { podSelector: { matchLabels: { app: "api" } }, ingress: [{ from: [{ ipBlock: { cidr: "10.1.0.0/16", except } }] }] }),
    ];
    expect(run(policy()).allowed).toBe(true);
    expect(run(policy(["10.1.0.0/24"])).allowed).toBe(false);
    expect(run(policy(), other, api).allowed).toBe(false);
  });
});
