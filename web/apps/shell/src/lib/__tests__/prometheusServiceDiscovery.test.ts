import { describe, it, expect } from "vitest";
import { findCandidatePrometheusServices, rankPrometheusServers, suggestLocalURL, portForwardCommand } from "../prometheusServiceDiscovery";

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

  it("suggests local port 9090 for a service on a privileged port, which a laptop can't bind", () => {
    expect(suggestLocalURL({ namespace: "monitoring", name: "prom", address: "http://prom.monitoring.svc" })).toBe("http://localhost:9090");
    expect(suggestLocalURL({ namespace: "monitoring", name: "prometheus-server", address: "http://prometheus-server.monitoring.svc:80" })).toBe(
      "http://localhost:9090",
    );
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

  it("forwards local 9090 to a service on port 80", () => {
    const candidate = { namespace: "monitoring", name: "prometheus-server", address: "http://prometheus-server.monitoring.svc:80" };
    expect(portForwardCommand(candidate)).toBe("kubectl -n monitoring port-forward svc/prometheus-server 9090:80");
  });

  it("extracts port correctly from various port numbers", () => {
    const candidate = { namespace: "kube-system", name: "metrics", address: "http://metrics.kube-system.svc:5000" };
    expect(portForwardCommand(candidate)).toBe("kubectl -n kube-system port-forward svc/metrics 5000:5000");
  });
});

describe("rankPrometheusServers", () => {
  // A stock kube-prometheus-stack install: only two of these serve the Prometheus API.
  const stack = findCandidatePrometheusServices([
    service({ name: "kube-prometheus-stack-grafana", ns: "monitoring", ports: [{ name: "http-web", port: 80 }] }),
    service({ name: "kube-prometheus-stack-alertmanager", ns: "monitoring", ports: [{ name: "http-web", port: 9093 }] }),
    service({ name: "kube-prometheus-stack-operator", ns: "monitoring", ports: [{ name: "https", port: 443 }] }),
    service({ name: "kube-prometheus-stack-kube-state-metrics", ns: "monitoring", ports: [{ name: "http", port: 8080 }] }),
    service({ name: "kube-prometheus-stack-prometheus-node-exporter", ns: "monitoring", ports: [{ name: "http-metrics", port: 9100 }] }),
    service({ name: "kube-prometheus-stack-kubelet", ns: "kube-system", ports: [{ name: "https-metrics", port: 10250 }] }),
    service({ name: "kube-prometheus-stack-coredns", ns: "kube-system", ports: [{ name: "http-metrics", port: 9153 }] }),
    service({ name: "prometheus-pushgateway", ns: "monitoring", ports: [{ port: 9091 }] }),
    service({ name: "prometheus-operated", ns: "monitoring", ports: [{ name: "http-web", port: 9090 }] }),
    service({ name: "kube-prometheus-stack-prometheus", ns: "monitoring", ports: [{ name: "http-web", port: 9090 }] }),
  ]);

  it("keeps only services that serve the Prometheus API, Prometheus itself first", () => {
    expect(rankPrometheusServers(stack).map((c) => c.name)).toEqual(["kube-prometheus-stack-prometheus", "prometheus-operated"]);
  });

  it("puts the usual Prometheus port first and shows at most four", () => {
    const many = findCandidatePrometheusServices(
      ["a", "b", "c", "d", "e"].map((n) => service({ name: `prometheus-${n}`, ns: "obs", ports: [{ port: 8080 }] })).concat(
        service({ name: "prometheus-z", ns: "obs", ports: [{ port: 9090 }] }),
      ),
    );
    const ranked = rankPrometheusServers(many);
    expect(ranked).toHaveLength(4);
    expect(ranked[0]!.name).toBe("prometheus-z");
  });
});
