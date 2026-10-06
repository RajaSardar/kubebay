import { describe, expect, it } from "vitest";
import { extraColumns, ownerCell } from "../ResourceTable";

// ── no pod columns here ──────────────────────────────────────────────────────

// Pods have their own page (pages/Workloads.tsx). A second, never-routed pod
// column set lived here (no "pods" ResourceDef exists, so /r/pods is "Unknown
// resource") and drifted from the real one; it is gone, as is the drawer's
// matching pod branch.
describe("pods are not a resource-table kind", () => {
  it("has no pod column set", () => {
    expect(extraColumns("pods")).toEqual({});
  });

  it("the generic drawer has no pod branch", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../../components/GenericDrawer.tsx"), "utf8");
    expect(src).not.toMatch(/slug === "pods"/);
    expect(src).not.toMatch(/\bisPod\b/);
  });
});

// ── events columns ───────────────────────────────────────────────────────────

describe("extraColumns('events') – Type", () => {
  const { Type } = extraColumns("events");

  it("marks Warning events with warn dot", () => {
    const cell = Type!({ type: "Warning" });
    expect(cell.v).toBe("Warning");
    expect(cell.dot).toBe("warn");
  });

  it("marks Normal events with ok dot", () => {
    const cell = Type!({ type: "Normal" });
    expect(cell.v).toBe("Normal");
    expect(cell.dot).toBe("ok");
  });

  it("defaults to ok for missing type", () => {
    const cell = Type!({});
    expect(cell.dot).toBe("ok");
  });
});

describe("extraColumns('events') – Reason", () => {
  const { Reason } = extraColumns("events");

  it("returns the reason string", () => {
    expect(Reason!({ reason: "BackOff" }).v).toBe("BackOff");
  });

  it("shows dash when reason absent", () => {
    expect(Reason!({}).v).toBe("–");
  });
});

describe("extraColumns('events') – Object", () => {
  const { Object: ObjectCol } = extraColumns("events");

  it("formats involvedObject as Kind/name", () => {
    const cell = ObjectCol!({ involvedObject: { kind: "Pod", name: "nginx-abc" } });
    expect(cell.v).toBe("Pod/nginx-abc");
  });

  it("shows dash when involvedObject is missing", () => {
    expect(ObjectCol!({}).v).toBe("–");
  });
});

describe("extraColumns('events') – Message", () => {
  const { Message } = extraColumns("events");

  it("truncates to 80 chars", () => {
    const long = "x".repeat(120);
    const cell = Message!({ message: long });
    expect(cell.v).toHaveLength(80);
  });

  it("returns full message when under 80 chars", () => {
    const cell = Message!({ message: "Back-off restarting failed container" });
    expect(cell.v).toBe("Back-off restarting failed container");
  });

  it("adds mono small class", () => {
    const cell = Message!({ message: "hello" });
    expect(cell.cls).toBe("mono small");
  });
});

describe("extraColumns('events') – Count", () => {
  const { Count } = extraColumns("events");

  it("returns the count as a string", () => {
    expect(Count!({ count: 42 }).v).toBe("42");
  });

  it("defaults to 1 when count is absent", () => {
    expect(Count!({}).v).toBe("1");
  });
});

// ── services columns (backlog #13) ───────────────────────────────────────────

describe("extraColumns('services') – External IP", () => {
  const { "External IP": ExternalIP } = extraColumns("services");

  it("shows load balancer IP for LoadBalancer services", () => {
    const svc = { spec: { type: "LoadBalancer", clusterIP: "10.0.0.1" }, status: { loadBalancer: { ingress: [{ ip: "1.2.3.4" }] } } };
    expect(ExternalIP!(svc).v).toBe("1.2.3.4");
  });

  it("shows hostname when load balancer provides a hostname instead of IP", () => {
    const svc = { spec: { type: "LoadBalancer", clusterIP: "10.0.0.1" }, status: { loadBalancer: { ingress: [{ hostname: "abc.elb.amazonaws.com" }] } } };
    expect(ExternalIP!(svc).v).toBe("abc.elb.amazonaws.com");
  });

  it("shows multiple LB IPs joined by comma", () => {
    const svc = { spec: { type: "LoadBalancer" }, status: { loadBalancer: { ingress: [{ ip: "1.2.3.4" }, { ip: "5.6.7.8" }] } } };
    expect(ExternalIP!(svc).v).toBe("1.2.3.4, 5.6.7.8");
  });

  it("shows externalName for ExternalName services", () => {
    const svc = { spec: { type: "ExternalName", externalName: "mydb.example.com" } };
    expect(ExternalIP!(svc).v).toBe("mydb.example.com");
  });

  it("shows dash for ClusterIP services (no external exposure)", () => {
    const svc = { spec: { type: "ClusterIP", clusterIP: "10.0.0.1" }, status: {} };
    expect(ExternalIP!(svc).v).toBe("–");
  });

  it("shows dash for pending LB with no ingress yet", () => {
    const svc = { spec: { type: "LoadBalancer" }, status: { loadBalancer: {} } };
    expect(ExternalIP!(svc).v).toBe("–");
  });
});

describe("extraColumns('services') – Port (all ports, not just first)", () => {
  const { Port } = extraColumns("services");

  it("shows all ports when there are multiple", () => {
    const svc = { spec: { ports: [{ port: 80, protocol: "TCP" }, { port: 443, protocol: "TCP" }] } };
    expect(Port!(svc).v).toBe("80/TCP, 443/TCP");
  });

  it("includes nodePort when present", () => {
    const svc = { spec: { ports: [{ port: 80, nodePort: 30080, protocol: "TCP" }] } };
    expect(Port!(svc).v).toBe("80:30080/TCP");
  });

  it("shows dash when no ports", () => {
    const svc = { spec: { ports: [] } };
    expect(Port!(svc).v).toBe("–");
  });
});

// ── unknown slug returns empty ────────────────────────────────────────────────

describe("extraColumns for unknown slug", () => {
  it("returns an empty object for unrecognised slugs", () => {
    expect(extraColumns("unknownresource")).toEqual({});
  });
});

// ── universal Owner column (GitOps ownership) ─────────────────────────────────

describe("ownerCell", () => {
  it("shows the Argo CD app name for an Argo-owned resource", () => {
    const cell = ownerCell({ metadata: { annotations: { "argocd.argoproj.io/instance": "my-app" } } });
    expect(cell.v).toBe("Argo CD: my-app");
  });

  it("shows the Flux Kustomization name for a Flux-owned resource", () => {
    const cell = ownerCell({ metadata: { annotations: { "kustomize.toolkit.fluxcd.io/name": "my-kustomization" } } });
    expect(cell.v).toBe("Flux: my-kustomization");
  });

  it("shows a dash for a resource with no GitOps owner", () => {
    const cell = ownerCell({ metadata: { annotations: {} } });
    expect(cell.v).toBe("–");
  });
});

// ── policyreports / clusterpolicyreports (Kyverno/Gatekeeper findings) ────────

describe("extraColumns('policyreports') – Summary", () => {
  const { Summary } = extraColumns("policyreports");

  it("shows an err dot when there are failures", () => {
    const cell = Summary!({ summary: { pass: 3, fail: 2, warn: 0, error: 0, skip: 0 } });
    expect(cell.v).toBe("3 pass, 2 fail");
    expect(cell.dot).toBe("err");
  });

  it("shows a warn dot when there are warnings but no failures or errors", () => {
    const cell = Summary!({ summary: { pass: 5, fail: 0, warn: 1, error: 0, skip: 0 } });
    expect(cell.v).toBe("5 pass, 1 warn");
    expect(cell.dot).toBe("warn");
  });

  it("shows an ok dot when everything passes", () => {
    const cell = Summary!({ summary: { pass: 4, fail: 0, warn: 0, error: 0, skip: 0 } });
    expect(cell.v).toBe("4 pass");
    expect(cell.dot).toBe("ok");
  });

  it("shows a dash when there is no summary at all", () => {
    expect(Summary!({}).v).toBe("–");
  });
});

describe("extraColumns('clusterpolicyreports')", () => {
  it("has the same Summary column as policyreports", () => {
    const cell = extraColumns("clusterpolicyreports").Summary!({ summary: { pass: 0, fail: 1, warn: 0, error: 0, skip: 0 } });
    expect(cell.dot).toBe("err");
  });
});

describe("extraColumns('nodes') – Karpenter columns", () => {
  const { NodePool, "Capacity type": CapacityType } = extraColumns("nodes");

  it("reads the NodePool from the karpenter.sh/nodepool label", () => {
    const cell = NodePool!({ metadata: { labels: { "karpenter.sh/nodepool": "default" } } });
    expect(cell.v).toBe("default");
  });

  it("shows a dash for a node Karpenter doesn't manage", () => {
    expect(NodePool!({ metadata: { labels: {} } }).v).toBe("–");
  });

  it("reads capacity type (spot/on-demand) from the karpenter.sh/capacity-type label", () => {
    const cell = CapacityType!({ metadata: { labels: { "karpenter.sh/capacity-type": "spot" } } });
    expect(cell.v).toBe("spot");
  });

  it("shows a dash for capacity type on a non-Karpenter node", () => {
    expect(CapacityType!({ metadata: { labels: {} } }).v).toBe("–");
  });
});
