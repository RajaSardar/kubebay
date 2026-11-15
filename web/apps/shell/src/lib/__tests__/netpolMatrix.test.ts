import { describe, it, expect } from "vitest";
import { matrixCell } from "../netpolMatrix";

type Obj = Record<string, unknown>;
const pod = (ns: string, app: string): Obj => ({ metadata: { name: `${app}-1`, namespace: ns, labels: { app } }, spec: { containers: [] }, status: {} });
const np = (name: string, namespace: string, spec: Obj): Obj => ({ metadata: { name, namespace }, spec });
const web = pod("shop", "web");
const api = pod("shop", "api");
const namespaces = [{ metadata: { name: "shop" } }];

describe("matrixCell", () => {
  it("is open when no policy selects either pod", () => {
    expect(matrixCell(web, api, [], namespaces)).toEqual({ status: "open", policies: [] });
  });

  it("stays open when the namespace's only policy selects other pods (isolation is per pod)", () => {
    const policies = [np("db-only", "shop", { podSelector: { matchLabels: { app: "db" } }, policyTypes: ["Ingress"] })];
    expect(matrixCell(web, api, policies, namespaces).status).toBe("open");
  });

  it("is blocked by an Ingress policy with no rules, rather than treated as allow-all", () => {
    const policies = [np("deny", "shop", { podSelector: { matchLabels: { app: "api" } }, policyTypes: ["Ingress"] })];
    expect(matrixCell(web, api, policies, namespaces)).toEqual({ status: "blocked", policies: [], blockedBy: ["ingress: shop/deny"] });
  });

  it("is blocked by the source's egress policy", () => {
    const policies = [np("no-egress", "shop", { podSelector: { matchLabels: { app: "web" } }, policyTypes: ["Egress"] })];
    expect(matrixCell(web, api, policies, namespaces)).toEqual({ status: "blocked", policies: [], blockedBy: ["egress: shop/no-egress"] });
  });

  it("is allowed, naming the allowing policies and any port restriction", () => {
    const policies = [
      np("api-8080", "shop", { podSelector: { matchLabels: { app: "api" } }, ingress: [{ from: [{ podSelector: { matchLabels: { app: "web" } } }], ports: [{ port: 8080 }] }] }),
    ];
    expect(matrixCell(web, api, policies, namespaces)).toEqual({ status: "allowed", policies: ["shop/api-8080"], allowedPorts: ["TCP/8080"] });
  });
});
