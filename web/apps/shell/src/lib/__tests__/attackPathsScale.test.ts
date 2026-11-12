import { describe, expect, it } from "vitest";
import { findAttackPaths, type AttackPathInput } from "../attackPaths";

// A large cluster: the page recomputes this on every stream flush, so one call
// has to stay cheap or the whole window stalls.
function bigCluster(): AttackPathInput {
  const NS = 300, PODS = 6000, SVC = 1500, REPORTS = 2500, VULNS = 20;
  const pods = Array.from({ length: PODS }, (_, i) => ({
    metadata: {
      name: `app-${i}-x`,
      namespace: `ns${i % NS}`,
      labels: { app: `app-${i % 1500}`, "app.kubernetes.io/name": i % 400 === 0 ? "ingress-nginx" : "x" },
      ownerReferences: [{ kind: "ReplicaSet", name: `app-${i % 1500}-rs`, controller: true }],
    },
    spec: { serviceAccountName: `sa${i % 900}`, containers: [{ name: "c" }] },
  }));
  const services = Array.from({ length: SVC }, (_, i) => ({
    metadata: { name: `svc-${i}`, namespace: `ns${i % NS}` },
    spec: { type: i % 3 === 0 ? "LoadBalancer" : "ClusterIP", selector: { app: `app-${i % 1500}` } },
  }));
  const ingresses = Array.from({ length: 400 }, (_, i) => ({
    metadata: { name: `ing${i}`, namespace: `ns${i % NS}` },
    spec: { rules: [{ host: `h${i}.x`, http: { paths: [{ backend: { service: { name: `svc-${i}` } } }] } }] },
  }));
  const networkPolicies = Array.from({ length: 900 }, (_, i) => ({
    metadata: { name: `np${i}`, namespace: `ns${i % NS}` },
    spec: { podSelector: { matchLabels: { app: `app-${i % 1500}` } }, policyTypes: ["Ingress"], ingress: [{ from: [{ podSelector: { matchLabels: { a: "b" } } }] }] },
  }));
  const vulnReports = Array.from({ length: REPORTS }, (_, i) => ({
    metadata: {
      name: `r${i}`,
      namespace: `ns${i % NS}`,
      labels: {
        "trivy-operator.resource.kind": "ReplicaSet",
        "trivy-operator.resource.name": `app-${i % 1500}-rs`,
        "trivy-operator.resource.namespace": `ns${i % NS}`,
        "trivy-operator.container.name": "c",
      },
    },
    report: { vulnerabilities: Array.from({ length: VULNS }, (_, j) => ({ vulnerabilityID: `CVE-${j}-${i}`, severity: j % 4 === 0 ? "CRITICAL" : "LOW" })) },
  }));
  const rbac = {
    roles: [],
    clusterRoles: Array.from({ length: 300 }, (_, i) => ({ name: `cr${i}`, kind: "ClusterRole", rules: [{ verbs: ["get"], apiGroups: [""], resources: ["secrets"] }] })),
    roleBindings: [],
    clusterRoleBindings: Array.from({ length: 700 }, (_, i) => ({
      name: `b${i}`,
      kind: "ClusterRoleBinding",
      roleRef: `ClusterRole:cr${i % 300}`,
      subjects: [{ kind: "ServiceAccount", name: `sa${i % 900}`, ns: `ns${i % NS}` }],
    })),
  };
  return { pods, services, ingresses, networkPolicies, vulnReports, rbacFindings: [], namespaces: [], rbac } as unknown as AttackPathInput;
}

describe("findAttackPaths at scale", () => {
  it("handles 6000 pods, 1500 services and 2500 Trivy reports without stalling", () => {
    const input = bigCluster();
    const start = performance.now();
    const paths = findAttackPaths(input);
    const ms = performance.now() - start;
    expect(paths.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(500);
  });
});
