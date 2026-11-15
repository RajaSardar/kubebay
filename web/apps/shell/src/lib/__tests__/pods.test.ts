import { describe, expect, it } from "vitest";
import { derivePod } from "../pods";

const pod = (over: { meta?: Record<string, unknown>; spec?: Record<string, unknown>; status?: Record<string, unknown> } = {}) => ({
  metadata: { name: "web-1", namespace: "shop", creationTimestamp: "2026-09-29T10:00:00Z", ...over.meta },
  spec: { nodeName: "node-a", containers: [{ name: "app" }, { name: "sidecar" }], ...over.spec },
  status: { phase: "Running", podIP: "10.0.0.5", ...over.status },
});

const running = (name: string, restartCount = 0) => ({ name, ready: true, restartCount, state: { running: {} } });

describe("derivePod", () => {
  it("is Running only when every container is ready", () => {
    const r = derivePod(pod({ status: { phase: "Running", containerStatuses: [running("app"), running("sidecar")] } }))!;
    expect(r).toMatchObject({ key: "shop/web-1", status: "running", statusLabel: "Running", ready: "2/2", node: "node-a", podIP: "10.0.0.5" });
  });

  it("shows the waiting reason, and its message for the status tooltip", () => {
    const r = derivePod(
      pod({
        status: {
          phase: "Running",
          containerStatuses: [
            running("sidecar"),
            { name: "app", ready: false, restartCount: 7, state: { waiting: { reason: "CrashLoopBackOff", message: "back-off 5m0s restarting failed container" } } },
          ],
        },
      }),
    )!;
    expect(r).toMatchObject({ status: "failed", statusLabel: "CrashLoopBackOff", statusDetail: "back-off 5m0s restarting failed container", ready: "1/2" });
  });

  it("does not treat ContainerCreating as a failure", () => {
    const r = derivePod(pod({ status: { phase: "Pending", containerStatuses: [{ name: "app", ready: false, state: { waiting: { reason: "ContainerCreating" } } }] } }))!;
    expect(r).toMatchObject({ status: "pending", statusLabel: "Pending" });
  });

  it("labels a pod being deleted Terminating", () => {
    const r = derivePod(pod({ meta: { deletionTimestamp: "2026-09-29T11:00:00Z" } }))!;
    expect(r).toMatchObject({ status: "pending", statusLabel: "Terminating" });
  });

  it("sums restarts across containers", () => {
    const r = derivePod(pod({ status: { containerStatuses: [running("app", 3), running("sidecar", 4)] } }))!;
    expect(r.restarts).toBe(7);
  });

  it("counts containers from the spec before any status arrives", () => {
    expect(derivePod(pod({ status: { phase: "Pending" } }))!).toMatchObject({ ready: "0/2", containers: ["app", "sidecar"] });
  });

  it("carries requests and limits for the usage bars", () => {
    const r = derivePod(pod({ spec: { containers: [{ name: "app", resources: { limits: { cpu: "500m" } } }] } }))!;
    expect(r.resources.cpuLimit).toBe(500);
  });

  it("skips an object with no name", () => {
    expect(derivePod({ metadata: {} })).toBeNull();
  });
});
