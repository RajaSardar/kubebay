import { describe, it, expect } from "vitest";
import { findCandidatePrometheusServices } from "../prometheusServiceDiscovery";

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
