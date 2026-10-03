import { describe, it, expect } from "vitest";
import { findCandidatePrometheusServices, suggestLocalURL, portForwardCommand } from "../prometheusServiceDiscovery";

function service(opts: {
  name: string;
  ns: string;
  labels?: Record<string, string>;
  ports?: { name?: string; port: number }[];
}) {
  return {
    metadata: { name: opts.name, namespace: opts.ns, labels: opts.labels ?? {} },
    spec: { ports: opts.ports ?? [{ port: 9090 }] },
  };
}

describe("findCandidatePrometheusServices", () => {
  it("matches a service named prometheus-server", () => {
    const candidates = findCandidatePrometheusServices([service({ name: "prometheus-server", ns: "monitoring" })]);
    expect(candidates).toEqual([{ namespace: "monitoring", name: "prometheus-server", address: "http://prometheus-server.monitoring.svc:9090" }]);
  });

  it("matches via app.kubernetes.io/name=prometheus label even with an unrelated name", () => {
    const candidates = findCandidatePrometheusServices([
      service({ name: "metrics-backend", ns: "obs", labels: { "app.kubernetes.io/name": "prometheus" } }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBe("metrics-backend");
  });

  it("ignores services with no prometheus signal at all", () => {
    const candidates = findCandidatePrometheusServices([service({ name: "checkout", ns: "team-a" })]);
    expect(candidates).toEqual([]);
  });

  it("prefers a port named web/http over the first port when multiple exist", () => {
    const candidates = findCandidatePrometheusServices([
      service({ name: "prometheus", ns: "monitoring", ports: [{ name: "reloader-web", port: 8080 }, { name: "http", port: 9090 }] }),
    ]);
    expect(candidates[0]!.address).toBe("http://prometheus.monitoring.svc:9090");
  });

  it("skips a matching service with no ports at all", () => {
    const candidates = findCandidatePrometheusServices([service({ name: "prometheus", ns: "monitoring", ports: [] })]);
    expect(candidates).toEqual([]);
  });

  it("returns one candidate per matching service across namespaces", () => {
    const candidates = findCandidatePrometheusServices([
      service({ name: "prometheus", ns: "monitoring" }),
      service({ name: "prometheus", ns: "team-a" }),
    ]);
    expect(candidates).toHaveLength(2);
  });
});

describe("suggestLocalURL", () => {
  it("extracts port from in-cluster DNS address and suggests localhost URL", () => {
    const candidate = { namespace: "monitoring", name: "prometheus-server", address: "http://prometheus-server.monitoring.svc:9090" };
    expect(suggestLocalURL(candidate)).toBe("http://localhost:9090");
  });

  it("handles different port numbers", () => {
    const candidate = { namespace: "obs", name: "prometheus", address: "http://prometheus.obs.svc:8080" };
    expect(suggestLocalURL(candidate)).toBe("http://localhost:8080");
  });

  it("handles addresses without explicit port (defaults to 80)", () => {
    const candidate = { namespace: "monitoring", name: "prom", address: "http://prom.monitoring.svc" };
    expect(suggestLocalURL(candidate)).toBe("http://localhost:80");
  });

  it("never returns an in-cluster DNS address", () => {
    const candidate = { namespace: "monitoring", name: "prometheus", address: "http://prometheus.monitoring.svc:9090" };
    const url = suggestLocalURL(candidate);
    expect(url).not.toContain(".svc");
    expect(url).toBe("http://localhost:9090");
  });
});

describe("portForwardCommand", () => {
  it("generates kubectl port-forward command from candidate", () => {
    const candidate = { namespace: "monitoring", name: "prometheus-server", address: "http://prometheus-server.monitoring.svc:9090" };
    expect(portForwardCommand(candidate)).toBe("kubectl -n monitoring port-forward svc/prometheus-server 9090:9090");
  });

  it("handles different namespaces and names", () => {
    const candidate = { namespace: "obs", name: "prom", address: "http://prom.obs.svc:8080" };
    expect(portForwardCommand(candidate)).toBe("kubectl -n obs port-forward svc/prom 8080:8080");
  });

  it("extracts port correctly from various port numbers", () => {
    const candidate = { namespace: "kube-system", name: "metrics", address: "http://metrics.kube-system.svc:5000" };
    expect(portForwardCommand(candidate)).toBe("kubectl -n kube-system port-forward svc/metrics 5000:5000");
  });
});
