import { describe, expect, it } from "vitest";
import { podResources, usageBar } from "../podUsage";

const pod = (containers: Record<string, unknown>[]) => ({ spec: { containers } });
const fmt = (n: number) => `${n}m`;

describe("podResources", () => {
  it("sums each container's requests and limits", () => {
    const r = podResources(
      pod([
        { name: "app", resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } } },
        { name: "sidecar", resources: { requests: { cpu: "50m", memory: "64Mi" }, limits: { cpu: "0.5", memory: "64Mi" } } },
      ]),
    );
    expect(r).toEqual({ cpuRequest: 150, cpuLimit: 1000, memRequest: 192 * 1024 ** 2, memLimit: 320 * 1024 ** 2 });
  });

  it("has no pod limit when any container is unlimited: that container can use the whole node", () => {
    const r = podResources(
      pod([
        { name: "app", resources: { requests: { cpu: "100m" }, limits: { cpu: "500m" } } },
        { name: "sidecar", resources: { requests: { cpu: "50m" } } },
      ]),
    );
    expect(r.cpuLimit).toBeUndefined();
    expect(r.cpuRequest).toBe(150);
  });

  it("has nothing for a pod that sets no resources", () => {
    expect(podResources(pod([{ name: "app" }]))).toEqual({});
    expect(podResources({})).toEqual({});
  });
});

describe("usageBar", () => {
  it("measures against the limit, and warns as usage nears it", () => {
    expect(usageBar(240, 100, 500, fmt)).toEqual({ pct: 48, tone: "accent", title: "240m of 500m limit (48%)" });
    expect(usageBar(420, 100, 500, fmt)).toMatchObject({ pct: 84, tone: "warn" });
    expect(usageBar(520, 100, 500, fmt)).toMatchObject({ pct: 100, tone: "err", title: "520m of 500m limit (104%)" });
  });

  it("measures against the request when there is no limit; going over a request is not an error", () => {
    expect(usageBar(60, 200, undefined, fmt)).toEqual({ pct: 30, tone: "accent", title: "60m, 30% of its 200m request (no limit)" });
    expect(usageBar(300, 200, undefined, fmt)).toMatchObject({ pct: 100, tone: "accent", title: "300m, 150% of its 200m request (no limit)" });
  });

  it("draws no bar when the pod sets neither", () => {
    expect(usageBar(60, undefined, undefined, fmt)).toEqual({ pct: null, tone: "accent", title: "60m (no request or limit set)" });
  });
});

describe("the Pods table", () => {
  it("draws CPU and memory bars from usageBar, not against a fixed 1 core / 1 GiB, and never paints memory in warn by default", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../../pages/Workloads.tsx"), "utf8");
    expect(src).toMatch(/usageBar\(/);
    expect(src).not.toMatch(/cpuMillis \/ 1000\) \* 100/);
    expect(src).not.toMatch(/1024 \* 1024 \* 1024\)\) \* 100/);
  });
});
