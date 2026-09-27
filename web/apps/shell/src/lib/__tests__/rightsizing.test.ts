import { describe, it, expect } from "vitest";
import {
  parseCpuMillis,
  parseMemBytes,
  formatCpuMillis,
  formatMemBytes,
  computeRightSizingRows,
  computeEngineRightSizingRows,
  mergeRightSizingRows,
  summarizeForWorkload,
  suggestedRequestsFor,
  buildResizePatchYaml,
  gvrForWorkloadKind,
} from "../rightsizing";
import type { WorkloadWaste } from "../api";

function vpa(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "app-vpa", namespace: "default" },
    spec: {
      targetRef: { apiVersion: "apps/v1", kind: "Deployment", name: "app" },
      updatePolicy: { updateMode: "Off" },
    },
    status: {
      recommendation: {
        containerRecommendations: [
          { containerName: "app", target: { cpu: "100m", memory: "128Mi" } },
        ],
      },
    },
    ...overrides,
  };
}

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "app", namespace: "default" },
    spec: {
      replicas: 3,
      template: {
        spec: {
          containers: [{ name: "app", resources: { requests: { cpu: "500m", memory: "512Mi" } } }],
        },
      },
    },
    ...overrides,
  };
}

function hpa(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "app-hpa", namespace: "default" },
    spec: {
      scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name: "app" },
      metrics: [{ type: "Resource", resource: { name: "cpu" } }],
    },
    ...overrides,
  };
}

describe("parseCpuMillis", () => {
  it("parses milli-suffixed values", () => {
    expect(parseCpuMillis("250m")).toBe(250);
  });
  it("parses plain core values as x1000 millis", () => {
    expect(parseCpuMillis("1")).toBe(1000);
    expect(parseCpuMillis("0.5")).toBe(500);
  });
  it("returns 0 for missing/undefined", () => {
    expect(parseCpuMillis(undefined)).toBe(0);
    expect(parseCpuMillis("")).toBe(0);
  });
});

describe("parseMemBytes", () => {
  it("parses Mi/Gi binary suffixes", () => {
    expect(parseMemBytes("128Mi")).toBe(128 * 1024 * 1024);
    expect(parseMemBytes("1Gi")).toBe(1024 * 1024 * 1024);
  });
  it("parses plain byte values", () => {
    expect(parseMemBytes("1024")).toBe(1024);
  });
  it("returns 0 for missing/undefined", () => {
    expect(parseMemBytes(undefined)).toBe(0);
  });
});

describe("format helpers", () => {
  it("formats cpu millis back to a human string", () => {
    expect(formatCpuMillis(250)).toBe("250m");
    expect(formatCpuMillis(1000)).toBe("1.00");
  });
  it("formats mem bytes back to a human string", () => {
    expect(formatMemBytes(128 * 1024 * 1024)).toBe("128Mi");
  });
});

describe("computeRightSizingRows", () => {
  it("produces one row per container recommendation with waste totals scaled by replicas", () => {
    const rows = computeRightSizingRows({ vpas: [vpa()], workloads: [deployment()], hpas: [] });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.ns).toBe("default");
    expect(r.workloadKind).toBe("Deployment");
    expect(r.workloadName).toBe("app");
    expect(r.container).toBe("app");
    expect(r.currentCpuMillis).toBe(500);
    expect(r.targetCpuMillis).toBe(100);
    // wasted = (current - target) * replicas = 400m * 3 = 1200m
    expect(r.wastedCpuMillis).toBe(1200);
    expect(r.wastedMemBytes).toBe((512 - 128) * 1024 * 1024 * 3);
  });

  it("gates materiality on both a >=20% relative delta and a minimum absolute delta", () => {
    // Small absolute delta even though relative % is huge: not material.
    const tinyVpa = vpa({
      status: { recommendation: { containerRecommendations: [{ containerName: "app", target: { cpu: "10m", memory: "128Mi" } }] } },
    });
    const tinyDeployment = deployment({
      spec: {
        replicas: 1,
        template: { spec: { containers: [{ name: "app", resources: { requests: { cpu: "20m", memory: "512Mi" } } }] } },
      },
    });
    const rows = computeRightSizingRows({ vpas: [tinyVpa], workloads: [tinyDeployment], hpas: [] });
    // cpu delta = 10m absolute (< 50m threshold) even though it's 50% relative;
    // memory delta = 384Mi absolute and > 20% relative -> material via memory.
    expect(rows[0]!.material).toBe(true);
    expect(rows[0]!.cpuMaterial).toBe(false);
    expect(rows[0]!.memMaterial).toBe(true);
  });

  it("excludes rows where neither dimension clears the materiality gate", () => {
    const closeVpa = vpa({
      status: { recommendation: { containerRecommendations: [{ containerName: "app", target: { cpu: "490m", memory: "500Mi" } }] } },
    });
    const rows = computeRightSizingRows({ vpas: [closeVpa], workloads: [deployment()], hpas: [] });
    expect(rows).toHaveLength(0);
  });

  it("flags an HPA-on-CPU conflict for the same target workload", () => {
    const rows = computeRightSizingRows({ vpas: [vpa()], workloads: [deployment()], hpas: [hpa()] });
    expect(rows[0]!.hpaCpuConflict).toBe(true);
  });

  it("does not flag a conflict when the HPA scales on a different workload", () => {
    const otherHpa = hpa({ spec: { scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name: "other" }, metrics: [{ type: "Resource", resource: { name: "cpu" } }] } });
    const rows = computeRightSizingRows({ vpas: [vpa()], workloads: [deployment()], hpas: [otherHpa] });
    expect(rows[0]!.hpaCpuConflict).toBe(false);
  });

  it("excludes VPAs targeting Jobs/CronJobs", () => {
    const jobVpa = vpa({ spec: { targetRef: { apiVersion: "batch/v1", kind: "CronJob", name: "app" }, updatePolicy: { updateMode: "Off" } } });
    const rows = computeRightSizingRows({ vpas: [jobVpa], workloads: [deployment()], hpas: [] });
    expect(rows).toHaveLength(0);
  });

  it("sorts by combined waste (cores + GiB) descending", () => {
    const smallWaste = vpa({
      metadata: { name: "small-vpa", namespace: "default" },
      spec: { targetRef: { apiVersion: "apps/v1", kind: "Deployment", name: "small" }, updatePolicy: { updateMode: "Off" } },
      status: { recommendation: { containerRecommendations: [{ containerName: "app", target: { cpu: "400m", memory: "400Mi" } }] } },
    });
    const smallDeployment = deployment({
      metadata: { name: "small", namespace: "default" },
      spec: { replicas: 1, template: { spec: { containers: [{ name: "app", resources: { requests: { cpu: "500m", memory: "500Mi" } } }] } } },
    });
    const rows = computeRightSizingRows({ vpas: [vpa(), smallWaste], workloads: [deployment(), smallDeployment], hpas: [] });
    expect(rows.map((r) => r.workloadName)).toEqual(["app", "small"]);
  });
});

describe("gvrForWorkloadKind", () => {
  it("maps the supported workload kinds to their GVR", () => {
    expect(gvrForWorkloadKind("Deployment")).toBe("apps/v1/deployments");
    expect(gvrForWorkloadKind("StatefulSet")).toBe("apps/v1/statefulsets");
    expect(gvrForWorkloadKind("DaemonSet")).toBe("apps/v1/daemonsets");
  });
});

describe("buildResizePatchYaml", () => {
  it("emits an SSA-shaped patch touching only the named containers' requests", () => {
    const yaml = buildResizePatchYaml(
      { kind: "Deployment", ns: "default", name: "app" },
      [{ name: "app", cpu: "100m", memory: "128Mi" }],
    );
    expect(yaml).toContain("apiVersion: apps/v1");
    expect(yaml).toContain("kind: Deployment");
    expect(yaml).toContain("name: app");
    expect(yaml).toContain("namespace: default");
    expect(yaml).toContain('cpu: "100m"');
    expect(yaml).toContain('memory: "128Mi"');
    // Never touches limits.
    expect(yaml).not.toContain("limits");
  });

  it("omits a dimension the caller didn't include (e.g. HPA-conflicted cpu)", () => {
    const yaml = buildResizePatchYaml(
      { kind: "Deployment", ns: "default", name: "app" },
      [{ name: "app", memory: "128Mi" }],
    );
    expect(yaml).not.toContain("cpu:");
    expect(yaml).toContain('memory: "128Mi"');
  });

  it("supports multiple containers in one patch", () => {
    const yaml = buildResizePatchYaml(
      { kind: "StatefulSet", ns: "ns1", name: "db" },
      [
        { name: "db", cpu: "200m" },
        { name: "sidecar", memory: "64Mi" },
      ],
    );
    expect(yaml).toContain("name: db");
    expect(yaml).toContain("name: sidecar");
    expect(yaml).toContain('cpu: "200m"');
    expect(yaml).toContain('memory: "64Mi"');
  });
});

function workloadWaste(overrides: Partial<WorkloadWaste> = {}): WorkloadWaste {
  return {
    cluster: "kind-dev",
    ns: "default",
    kind: "Deployment",
    name: "engine-app",
    podCount: 3,
    requestedCpuMillis: 1500,
    requestedMemBytes: 1536 * 1024 * 1024,
    p95CpuMillis: 300,
    p95MemBytes: 512 * 1024 * 1024,
    source: "metrics-server",
    window: "observed over 3h, 180 samples",
    ...overrides,
  };
}

describe("computeEngineRightSizingRows", () => {
  it("builds a workload-level row from a WorkloadWaste entry", () => {
    const rows = computeEngineRightSizingRows([workloadWaste()], []);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.workloadKind).toBe("Deployment");
    expect(r.workloadName).toBe("engine-app");
    expect(r.replicas).toBe(3);
    expect(r.currentCpuMillis).toBe(1500);
    expect(r.targetCpuMillis).toBe(300);
    expect(r.wastedCpuMillis).toBe(1200);
    expect(r.source).toBe("metrics-server");
    expect(r.window).toBe("observed over 3h, 180 samples");
  });

  it("applies the same materiality gate as VPA rows", () => {
    const closeToTarget = workloadWaste({ requestedCpuMillis: 310, p95CpuMillis: 300, requestedMemBytes: 500, p95MemBytes: 490 });
    expect(computeEngineRightSizingRows([closeToTarget], [])).toHaveLength(0);
  });

  it("flags an HPA-on-CPU conflict for the same workload", () => {
    const hpa = {
      metadata: { name: "app-hpa", namespace: "default" },
      spec: { scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name: "engine-app" }, metrics: [{ type: "Resource", resource: { name: "cpu" } }] },
    };
    const rows = computeEngineRightSizingRows([workloadWaste()], [hpa]);
    expect(rows[0]!.hpaCpuConflict).toBe(true);
  });

  it("uses podCount as the replica count, defaulting to 1 if zero", () => {
    const rows = computeEngineRightSizingRows([workloadWaste({ podCount: 0 })], []);
    expect(rows[0]!.replicas).toBe(1);
  });
});

describe("mergeRightSizingRows", () => {
  it("keeps a VPA row and drops an engine row for the same workload", () => {
    const vpaRows = computeRightSizingRows({
      vpas: [
        {
          metadata: { name: "app-vpa", namespace: "default" },
          spec: { targetRef: { apiVersion: "apps/v1", kind: "Deployment", name: "engine-app" }, updatePolicy: { updateMode: "Off" } },
          status: { recommendation: { containerRecommendations: [{ containerName: "app", target: { cpu: "300m", memory: "512Mi" } }] } },
        },
      ],
      workloads: [
        {
          metadata: { name: "engine-app", namespace: "default" },
          spec: { replicas: 3, template: { spec: { containers: [{ name: "app", resources: { requests: { cpu: "500m", memory: "512Mi" } } }] } } },
        },
      ],
      hpas: [],
    });
    const engineRows = computeEngineRightSizingRows([workloadWaste()], []);
    const merged = mergeRightSizingRows(vpaRows, engineRows);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("vpa");
  });

  it("keeps an engine row when no VPA row exists for that workload", () => {
    const merged = mergeRightSizingRows([], computeEngineRightSizingRows([workloadWaste()], []));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("metrics-server");
  });

  it("sorts the combined list by waste score descending", () => {
    const small = computeEngineRightSizingRows([workloadWaste({ name: "small", requestedCpuMillis: 400, p95CpuMillis: 300 })], []);
    const big = computeEngineRightSizingRows([workloadWaste({ name: "big", requestedCpuMillis: 5000, p95CpuMillis: 100 })], []);
    const merged = mergeRightSizingRows([], [...small, ...big]);
    expect(merged.map((r) => r.workloadName)).toEqual(["big", "small"]);
  });
});

describe("summarizeForWorkload", () => {
  it("returns null when no row matches this workload", () => {
    const rows = computeEngineRightSizingRows([workloadWaste({ name: "other" })], []);
    expect(summarizeForWorkload(rows, { ns: "default", kind: "Deployment", name: "engine-app" })).toBeNull();
  });

  it("sums waste across all matching rows for the workload's own banner", () => {
    const rows = computeEngineRightSizingRows([workloadWaste()], []);
    const summary = summarizeForWorkload(rows, { ns: "default", kind: "Deployment", name: "engine-app" });
    expect(summary).not.toBeNull();
    expect(summary!.wastedCpuMillis).toBe(1200);
    expect(summary!.rows).toHaveLength(1);
  });

  it("does not match a row for the same name but a different kind", () => {
    const rows = computeEngineRightSizingRows([workloadWaste()], []);
    expect(summarizeForWorkload(rows, { ns: "default", kind: "StatefulSet", name: "engine-app" })).toBeNull();
  });
});

describe("suggestedRequestsFor", () => {
  it("matches a VPA row by exact container name and returns quantity strings", () => {
    const rows = computeRightSizingRows({
      vpas: [vpa()],
      workloads: [deployment()],
      hpas: [],
    });
    const s = suggestedRequestsFor(rows, { ns: "default", kind: "Deployment", name: "app", container: "app" });
    expect(s).toEqual({ cpu: "100m", memory: "128Mi" });
  });

  it("does not match a VPA row for a different container name", () => {
    const rows = computeRightSizingRows({ vpas: [vpa()], workloads: [deployment()], hpas: [] });
    expect(suggestedRequestsFor(rows, { ns: "default", kind: "Deployment", name: "app", container: "sidecar" })).toBeNull();
  });

  it("matches an engine (workload-level) row regardless of the container name", () => {
    const rows = computeEngineRightSizingRows([workloadWaste({ ns: "default", kind: "Deployment", name: "engine-app" })], []);
    const s = suggestedRequestsFor(rows, { ns: "default", kind: "Deployment", name: "engine-app", container: "any-container" });
    expect(s).toEqual({ cpu: "300m", memory: "512Mi" });
  });

  it("returns null when nothing matches", () => {
    const rows = computeEngineRightSizingRows([workloadWaste()], []);
    expect(suggestedRequestsFor(rows, { ns: "default", kind: "Deployment", name: "nope", container: "app" })).toBeNull();
  });
});
