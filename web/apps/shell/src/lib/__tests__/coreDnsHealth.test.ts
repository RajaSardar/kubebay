import { describe, it, expect } from "vitest";
import { checkCoreDns } from "../coreDnsHealth";

const DEFAULT_COREFILE = `.:53 {
    errors
    health {
       lameduck 5s
    }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
       pods insecure
       fallthrough in-addr.arpa ip6.arpa
    }
    prometheus :9153
    forward . /etc/resolv.conf
    cache 30
    loop
    reload
    loadbalance
}`;

function deployment(replicas: number, readyReplicas: number, name = "coredns") {
  return {
    metadata: { namespace: "kube-system", name, labels: { "k8s-app": "kube-dns" } },
    spec: { replicas },
    status: { readyReplicas },
  };
}
function pod(name: string, nodeName: string) {
  return { metadata: { namespace: "kube-system", name, labels: { "k8s-app": "kube-dns" } }, spec: { nodeName }, status: { phase: "Running" } };
}
function corefile(content: string) {
  return { metadata: { namespace: "kube-system", name: "coredns" }, data: { Corefile: content } };
}

const kinds = (r: ReturnType<typeof checkCoreDns>) => r.findings.map((f) => f.kind).sort();

describe("checkCoreDns", () => {
  it("reports no issues for a healthy two-replica CoreDNS on two nodes with the default Corefile", () => {
    const r = checkCoreDns([deployment(2, 2)], [pod("a", "n1"), pod("b", "n2")], [corefile(DEFAULT_COREFILE)]);
    expect(r.present).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("says CoreDNS isn't present when no kube-dns deployment exists", () => {
    const r = checkCoreDns([], [], []);
    expect(r.present).toBe(false);
    expect(r.findings).toEqual([]);
  });

  it("finds a legacy kube-dns deployment by its k8s-app label", () => {
    const r = checkCoreDns([deployment(2, 2, "kube-dns")], [pod("a", "n1"), pod("b", "n2")], []);
    expect(r.present).toBe(true);
  });

  it("ignores a deployment with the label outside kube-system", () => {
    const d = { ...deployment(1, 1), metadata: { namespace: "default", name: "coredns", labels: { "k8s-app": "kube-dns" } } };
    expect(checkCoreDns([d], [], []).present).toBe(false);
  });

  it("flags a single replica as a cluster-wide DNS single point of failure", () => {
    const r = checkCoreDns([deployment(1, 1)], [pod("a", "n1")], [corefile(DEFAULT_COREFILE)]);
    expect(kinds(r)).toEqual(["single-replica"]);
  });

  it("flags replicas that are not ready", () => {
    const r = checkCoreDns([deployment(2, 1)], [pod("a", "n1"), pod("b", "n2")], [corefile(DEFAULT_COREFILE)]);
    expect(kinds(r)).toEqual(["not-ready"]);
    expect(r.findings[0]?.detail).toMatch(/1 of 2/);
  });

  it("treats a missing readyReplicas as zero ready", () => {
    const d = { ...deployment(2, 0), status: {} };
    expect(kinds(checkCoreDns([d], [pod("a", "n1"), pod("b", "n2")], [corefile(DEFAULT_COREFILE)]))).toEqual(["not-ready"]);
  });

  it("flags every DNS replica running on the same node", () => {
    const r = checkCoreDns([deployment(2, 2)], [pod("a", "n1"), pod("b", "n1")], [corefile(DEFAULT_COREFILE)]);
    expect(kinds(r)).toEqual(["same-node"]);
  });

  it("flags each standard plugin missing from the Corefile", () => {
    const stripped = DEFAULT_COREFILE.replace(/^\s*loop\n/m, "").replace(/^\s*cache 30\n/m, "");
    const r = checkCoreDns([deployment(2, 2)], [pod("a", "n1"), pod("b", "n2")], [corefile(stripped)]);
    expect(kinds(r)).toEqual(["corefile-missing-cache", "corefile-missing-loop"]);
  });

  it("does not treat a plugin name inside another word or a comment as present", () => {
    const tricky = DEFAULT_COREFILE.replace(/^\s*loop\n/m, "    # loop disabled for testing\n    loopback-thing\n");
    const r = checkCoreDns([deployment(2, 2)], [pod("a", "n1"), pod("b", "n2")], [corefile(tricky)]);
    expect(kinds(r)).toEqual(["corefile-missing-loop"]);
  });

  it("skips the Corefile checks when the ConfigMap isn't visible", () => {
    const r = checkCoreDns([deployment(2, 2)], [pod("a", "n1"), pod("b", "n2")], []);
    expect(r.findings).toEqual([]);
    expect(r.corefileChecked).toBe(false);
  });
});
