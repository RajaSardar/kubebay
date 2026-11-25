import { describe, expect, it } from "vitest";
import { computeIssues, type IssueInputs } from "../issues";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
type Obj = Record<string, unknown>;

const crashing = (name: string, owner?: { kind: string; name: string }): Obj => ({
  metadata: { name, namespace: "shop", creationTimestamp: ago(60), ownerReferences: owner ? [{ ...owner, controller: true }] : [] },
  spec: { nodeName: "n1" },
  status: { phase: "Running", containerStatuses: [{ ready: false, restartCount: 5, state: { waiting: { reason: "CrashLoopBackOff" } } }] },
});
const node: Obj = { metadata: { name: "n1" }, status: { conditions: [{ type: "Ready", status: "True" }] } };
const base: IssueInputs = { pods: [], deployments: [], statefulsets: [], daemonsets: [], nodes: [node], now: NOW };
const podIssues = (input: IssueInputs) => computeIssues("c", input).issues.filter((i) => i.detector === "pod-problem");

describe("severity is not inflated", () => {
  it("a lone crashing pod or a failing Job is high, not critical", () => {
    expect(podIssues({ ...base, pods: [crashing("solo")] })[0]!.severity).toBe("high");
    expect(podIssues({ ...base, pods: [crashing("j-1", { kind: "Job", name: "j" })] })[0]!.severity).toBe("high");
  });
  it("a Deployment with no ready pod is still critical", () => {
    const meta = (h: string) => ({ ...(crashing("d-1") as { metadata: Obj }).metadata, labels: { "pod-template-hash": h }, ownerReferences: [{ kind: "ReplicaSet", name: `d-${h}`, controller: true }] });
    const p = { ...crashing("d-1"), metadata: meta("abc") };
    const dep = { metadata: { name: "d", namespace: "shop" }, spec: { replicas: 1 }, status: { readyReplicas: 0 } };
    expect(podIssues({ ...base, pods: [p], deployments: [dep] })[0]!.severity).toBe("critical");
  });
});

describe("certificates in issuance", () => {
  const cert = (name: string, status: Obj, created = 60): Obj => ({ metadata: { name, namespace: "shop", creationTimestamp: ago(created) }, status });
  const run = (c: Obj) => computeIssues("c", { ...base, certificates: [c] }).issues.filter((i) => i.detector === "cert-expiry");
  it("a certificate still being issued is not an issue", () => {
    expect(run(cert("new", { conditions: [{ type: "Ready", status: "False", lastTransitionTime: ago(2) }] }, 2))).toEqual([]);
  });
  it("a not Ready certificate with time left is high, not critical", () => {
    const r = run(cert("renew", { notAfter: new Date(NOW + 90 * 86_400_000).toISOString(), conditions: [{ type: "Ready", status: "False", lastTransitionTime: ago(90) }] }));
    expect(r[0]).toMatchObject({ code: "CertificateNotReady", severity: "high" });
  });
});
