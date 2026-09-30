import { describe, it, expect } from "vitest";
import { findOrphanedSecrets } from "../orphanedSecrets";

type Obj = Record<string, unknown>;

const secret = (name: string, ns = "shop", meta: Obj = {}): Obj => ({ metadata: { name, namespace: ns, ...meta } });
const pod = (spec: Obj, ns = "shop"): Obj => ({ metadata: { name: "p", namespace: ns }, spec });
const deployment = (podSpec: Obj, ns = "shop"): Obj => ({ kind: "Deployment", metadata: { name: "d", namespace: ns }, spec: { template: { spec: podSpec } } });
const cronJob = (podSpec: Obj, ns = "shop"): Obj => ({
  kind: "CronJob",
  metadata: { name: "cj", namespace: ns },
  spec: { jobTemplate: { spec: { template: { spec: podSpec } } } },
});

const empty = { pods: [], workloads: [], serviceAccounts: [], ingresses: [] };
const names = (r: ReturnType<typeof findOrphanedSecrets>) => r.map((s) => `${s.namespace}/${s.name}`);

describe("findOrphanedSecrets", () => {
  it("flags a Secret nothing references", () => {
    expect(names(findOrphanedSecrets({ ...empty, secrets: [secret("old-creds")] }))).toEqual(["shop/old-creds"]);
  });

  it.each([
    ["a secret volume", { volumes: [{ name: "v", secret: { secretName: "s" } }] }],
    ["a projected volume", { volumes: [{ name: "v", projected: { sources: [{ secret: { name: "s" } }] } }] }],
    ["an env secretKeyRef", { containers: [{ name: "c", env: [{ name: "X", valueFrom: { secretKeyRef: { name: "s", key: "k" } } }] }] }],
    ["an envFrom secretRef", { containers: [{ name: "c", envFrom: [{ secretRef: { name: "s" } }] }] }],
    ["an init container env", { initContainers: [{ name: "i", envFrom: [{ secretRef: { name: "s" } }] }] }],
    ["an imagePullSecret", { imagePullSecrets: [{ name: "s" }] }],
  ])("treats %s in a running pod as a use", (_label, spec) => {
    expect(findOrphanedSecrets({ ...empty, secrets: [secret("s")], pods: [pod(spec)] })).toEqual([]);
  });

  it("only counts references from the Secret's own namespace", () => {
    const r = findOrphanedSecrets({ ...empty, secrets: [secret("s")], pods: [pod({ imagePullSecrets: [{ name: "s" }] }, "other")] });
    expect(names(r)).toEqual(["shop/s"]);
  });

  it("counts workload templates, so a Deployment scaled to zero or a CronJob between runs still uses its Secret", () => {
    const secrets = [secret("dep"), secret("cron")];
    const workloads = [
      deployment({ volumes: [{ name: "v", secret: { secretName: "dep" } }] }),
      cronJob({ containers: [{ name: "c", envFrom: [{ secretRef: { name: "cron" } }] }] }),
    ];
    expect(findOrphanedSecrets({ ...empty, secrets, workloads })).toEqual([]);
  });

  it("counts ServiceAccount secrets and imagePullSecrets, and Ingress TLS", () => {
    const secrets = [secret("sa-tok"), secret("sa-pull"), secret("tls")];
    const serviceAccounts = [{ metadata: { name: "sa", namespace: "shop" }, secrets: [{ name: "sa-tok" }], imagePullSecrets: [{ name: "sa-pull" }] }];
    const ingresses = [{ metadata: { name: "i", namespace: "shop" }, spec: { tls: [{ secretName: "tls" }] } }];
    expect(findOrphanedSecrets({ ...empty, secrets, serviceAccounts, ingresses })).toEqual([]);
  });

  it("skips Secrets that are managed or used outside pod specs", () => {
    const secrets = [
      secret("sh.helm.release.v1.shop.v3", "shop", { labels: { owner: "helm" } }),
      secret("legacy-token", "shop", { annotations: { "kubernetes.io/service-account.name": "default" } }),
      secret("owned", "shop", { ownerReferences: [{ kind: "Certificate", name: "c" }] }),
      secret("cert", "shop", { annotations: { "cert-manager.io/certificate-name": "c" } }),
      secret("anything", "kube-system"),
    ];
    expect(findOrphanedSecrets({ ...empty, secrets })).toEqual([]);
  });

  it("sorts by namespace then name and reports the creation time", () => {
    const secrets = [
      secret("b", "shop", { creationTimestamp: "2026-01-01T00:00:00Z" }),
      secret("a", "shop"),
      secret("z", "billing"),
    ];
    const r = findOrphanedSecrets({ ...empty, secrets });
    expect(names(r)).toEqual(["billing/z", "shop/a", "shop/b"]);
    expect(r[2]?.createdAt).toBe("2026-01-01T00:00:00Z");
  });
});
