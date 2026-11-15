import { describe, it, expect } from "vitest";
import { findUnusedServiceAccounts, type BindingLike } from "../unusedServiceAccounts";

type Obj = Record<string, unknown>;

const sa = (name: string, ns = "shop", meta: Obj = {}): Obj => ({ metadata: { name, namespace: ns, creationTimestamp: "2026-01-01T00:00:00Z", ...meta } });
const pod = (spec: Obj, ns = "shop"): Obj => ({ metadata: { name: "p", namespace: ns }, spec });
const deployment = (podSpec: Obj, ns = "shop"): Obj => ({ kind: "Deployment", metadata: { name: "d", namespace: ns }, spec: { template: { spec: podSpec } } });
const cronJob = (podSpec: Obj, ns = "shop"): Obj => ({
  kind: "CronJob",
  metadata: { name: "cj", namespace: ns },
  spec: { jobTemplate: { spec: { template: { spec: podSpec } } } },
});
const tokenSecret = (name: string, saName: string, ns = "shop"): Obj => ({
  metadata: { name, namespace: ns, annotations: { "kubernetes.io/service-account.name": saName } },
});

const empty = { serviceAccounts: [], pods: [], workloads: [], bindings: [], secrets: [] };
const names = (r: ReturnType<typeof findUnusedServiceAccounts>) => r.map((s) => `${s.namespace}/${s.name}`);

describe("findUnusedServiceAccounts", () => {
  it("flags a ServiceAccount no pod or workload runs as", () => {
    expect(names(findUnusedServiceAccounts({ ...empty, serviceAccounts: [sa("old-bot")] }))).toEqual(["shop/old-bot"]);
  });

  it("treats a running pod as a use, through serviceAccountName or the deprecated serviceAccount", () => {
    const sas = [sa("a"), sa("b")];
    const pods = [pod({ serviceAccountName: "a" }), pod({ serviceAccount: "b" })];
    expect(findUnusedServiceAccounts({ ...empty, serviceAccounts: sas, pods })).toEqual([]);
  });

  it("counts workload templates, so a Deployment scaled to zero or a CronJob between runs still uses its ServiceAccount", () => {
    const sas = [sa("dep"), sa("cron")];
    const workloads = [deployment({ serviceAccountName: "dep" }), cronJob({ serviceAccountName: "cron" })];
    expect(findUnusedServiceAccounts({ ...empty, serviceAccounts: sas, workloads })).toEqual([]);
  });

  it("only counts uses from the ServiceAccount's own namespace", () => {
    const r = findUnusedServiceAccounts({ ...empty, serviceAccounts: [sa("bot")], pods: [pod({ serviceAccountName: "bot" }, "other")] });
    expect(names(r)).toEqual(["shop/bot"]);
  });

  it("skips the per-namespace default ServiceAccount, the system namespaces and owned ServiceAccounts", () => {
    const sas = [
      sa("default"),
      sa("attachdetach-controller", "kube-system"),
      sa("x", "kube-public"),
      sa("y", "kube-node-lease"),
      sa("owned", "shop", { ownerReferences: [{ kind: "Foo", name: "f" }] }),
    ];
    expect(findUnusedServiceAccounts({ ...empty, serviceAccounts: sas })).toEqual([]);
  });

  it("lists the bindings that grant an unused ServiceAccount permissions, and ranks those first", () => {
    const bindings: BindingLike[] = [
      { kind: "RoleBinding", name: "deployer", ns: "shop", roleRef: "Role:edit-things", subjects: [{ kind: "ServiceAccount", name: "ci", ns: "shop" }] },
      { kind: "ClusterRoleBinding", name: "ci-admin", roleRef: "ClusterRole:cluster-admin", subjects: [{ kind: "ServiceAccount", name: "ci", ns: "shop" }] },
      // Same name, other namespace: not this ServiceAccount.
      { kind: "RoleBinding", name: "x", ns: "other", roleRef: "Role:r", subjects: [{ kind: "ServiceAccount", name: "aaa", ns: "other" }] },
    ];
    const r = findUnusedServiceAccounts({ ...empty, serviceAccounts: [sa("aaa"), sa("ci")], bindings });
    expect(names(r)).toEqual(["shop/ci", "shop/aaa"]);
    expect(r[0]?.bindings).toEqual(["ClusterRoleBinding ci-admin → ClusterRole:cluster-admin", "RoleBinding shop/deployer → Role:edit-things"]);
    expect(r[1]?.bindings).toEqual([]);
  });

  it("names long-lived token Secrets, since something outside the cluster may be using one", () => {
    const r = findUnusedServiceAccounts({ ...empty, serviceAccounts: [sa("ci")], secrets: [tokenSecret("ci-token", "ci"), tokenSecret("t", "ci", "other")] });
    expect(r[0]?.tokenSecrets).toEqual(["ci-token"]);
  });
});
