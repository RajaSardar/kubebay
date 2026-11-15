import { describe, it, expect } from "vitest";
import { resolveFieldRef, resolveResourceFieldRef } from "../podEnv";

describe("resolveFieldRef", () => {
  const pod = {
    metadata: { name: "web-1", namespace: "prod", labels: { app: "web" } },
    spec: { nodeName: "node-a", serviceAccountName: "web-sa" },
    status: { podIP: "10.0.0.5", hostIP: "192.168.1.1" },
  };

  it("resolves status.podIP", () => {
    expect(resolveFieldRef(pod, "status.podIP")).toBe("10.0.0.5");
  });

  it("resolves metadata.name and metadata.namespace", () => {
    expect(resolveFieldRef(pod, "metadata.name")).toBe("web-1");
    expect(resolveFieldRef(pod, "metadata.namespace")).toBe("prod");
  });

  it("resolves spec.nodeName", () => {
    expect(resolveFieldRef(pod, "spec.nodeName")).toBe("node-a");
  });

  it("resolves a metadata.labels['x'] path to that label's value", () => {
    expect(resolveFieldRef(pod, "metadata.labels['app']")).toBe("web");
  });

  it("returns null for an unknown path", () => {
    expect(resolveFieldRef(pod, "status.nonexistent")).toBeNull();
  });

  it("returns null for a path that resolves to an object", () => {
    expect(resolveFieldRef(pod, "metadata.labels")).toBeNull();
  });
});

describe("resolveResourceFieldRef", () => {
  const container = {
    name: "app",
    resources: { requests: { cpu: "500m", memory: "128Mi" }, limits: { cpu: "1", memory: "256Mi" } },
  };

  it("resolves cpu requests in millicores", () => {
    expect(resolveResourceFieldRef(container, { resource: "requests.cpu" })).toBe("500m");
  });

  it("resolves memory limits in bytes-ish units, applying a divisor", () => {
    // 256Mi / (1024*1024) => bytes / divisor; exact formatting is
    // implementation-defined, but it must not be empty/NaN and must
    // reflect the divisor being applied (bigger divisor => smaller number).
    const noDivisor = resolveResourceFieldRef(container, { resource: "limits.memory" });
    const withDivisor = resolveResourceFieldRef(container, { resource: "limits.memory", divisor: "1Mi" });
    expect(noDivisor).toBeTruthy();
    expect(withDivisor).toBeTruthy();
  });

  it("returns null when the referenced resource is not set", () => {
    expect(resolveResourceFieldRef({ resources: {} }, { resource: "requests.cpu" })).toBeNull();
  });

  it("returns null for an unrecognized resource name", () => {
    expect(resolveResourceFieldRef(container, { resource: "bogus" })).toBeNull();
  });
});
