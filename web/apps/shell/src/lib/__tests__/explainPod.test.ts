import { describe, it, expect } from "vitest";
import { explainPod, type PodEvent } from "../explainPod";

type Obj = Record<string, unknown>;

function pod(status: Obj, spec: Obj = {}, extraMeta: Obj = {}): Obj {
  return {
    metadata: { name: "web-1", namespace: "prod", ...extraMeta },
    spec: { nodeName: "node-a", containers: [{ name: "app", image: "app:1.0" }], ...spec },
    status,
  };
}

const ready = { type: "Ready", status: "True" };
const notReadyCond = { type: "Ready", status: "False" };
const healthy = pod({ phase: "Running", conditions: [ready], containerStatuses: [{ name: "app", ready: true, restartCount: 0, state: { running: {} } }] });

const waiting = (reason: string, message = "", extra: Obj = {}) =>
  pod({ phase: "Running", containerStatuses: [{ name: "app", ready: false, restartCount: 3, state: { waiting: { reason, message } }, ...extra }] });

describe("explainPod: healthy pods say nothing", () => {
  it.each([
    ["running and ready", healthy],
    ["succeeded job pod", pod({ phase: "Succeeded" })],
    ["ContainerCreating (normal startup)", pod({ phase: "Pending", containerStatuses: [{ name: "app", ready: false, state: { waiting: { reason: "ContainerCreating" } } }] })],
    ["ready pod that once was OOMKilled", pod({ phase: "Running", conditions: [ready], containerStatuses: [{ name: "app", ready: true, restartCount: 1, state: { running: {} }, lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } } }] })],
    ["empty object", {}],
  ])("%s", (_n, p) => {
    expect(explainPod(p as Obj, [])).toBeNull();
  });
});

describe("explainPod: causes", () => {
  it("CrashLoopBackOff cites the last exit code and links previous logs first", () => {
    const e = explainPod(waiting("CrashLoopBackOff", "back-off", { lastState: { terminated: { reason: "Error", exitCode: 1 } } }), [])!;
    expect(e.cause).toBe("crash-loop");
    expect(e.diagnosis).toMatch(/exit code 1/);
    expect(e.diagnosis).toMatch(/Container "app"/);
    expect(e.cites).toMatch(/containerStatuses/);
    expect(e.steps[0]!.action).toEqual({ kind: "logs", container: "app", previous: true });
    expect(e.steps.some((s) => s.action.kind === "events")).toBe(true);
  });

  it("CrashLoopBackOff without a last state still explains", () => {
    const e = explainPod(waiting("CrashLoopBackOff"), [])!;
    expect(e.cause).toBe("crash-loop");
    expect(e.diagnosis).not.toMatch(/exit code/);
  });

  it("OOMKilled (last state) reports exit code and memory limit and links YAML", () => {
    const p = pod(
      { phase: "Running", containerStatuses: [{ name: "app", ready: false, restartCount: 4, state: { waiting: { reason: "CrashLoopBackOff" } }, lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } } }] },
      { containers: [{ name: "app", image: "a", resources: { limits: { memory: "256Mi" } } }] },
    );
    const e = explainPod(p, [])!;
    expect(e.cause).toBe("oom-killed");
    expect(e.diagnosis).toMatch(/OOMKilled/);
    expect(e.diagnosis).toMatch(/exit code 137/);
    expect(e.diagnosis).toMatch(/256Mi/);
    expect(e.diagnosis).toMatch(/likely/i);
    expect(e.steps.some((s) => s.action.kind === "yaml")).toBe(true);
    expect(e.steps.length).toBeLessThanOrEqual(3);
  });

  it("OOMKilled with no memory limit says so", () => {
    const p = pod({ phase: "Failed", containerStatuses: [{ name: "app", ready: false, state: { terminated: { reason: "OOMKilled", exitCode: 137 } } }] });
    const e = explainPod(p, [])!;
    expect(e.cause).toBe("oom-killed");
    expect(e.diagnosis).toMatch(/no memory limit/i);
  });

  it.each(["ImagePullBackOff", "ErrImagePull", "InvalidImageName"])("%s names the image", (reason) => {
    const p = pod(
      { phase: "Pending", containerStatuses: [{ name: "app", ready: false, state: { waiting: { reason, message: "pull access denied" } } }] },
      { containers: [{ name: "app", image: "reg.io/x/app:9" }] },
    );
    const e = explainPod(p, [])!;
    expect(e.cause).toBe("image-pull");
    expect(e.diagnosis).toMatch(/reg\.io\/x\/app:9/);
    expect(e.diagnosis).toMatch(/pull access denied/);
    expect(e.steps.some((s) => s.action.kind === "events")).toBe(true);
    expect(e.steps.some((s) => s.action.kind === "yaml")).toBe(true);
  });

  it("init container image pull is found too", () => {
    const p = pod({ phase: "Pending", initContainerStatuses: [{ name: "init", ready: false, state: { waiting: { reason: "ErrImagePull" } } }] });
    expect(explainPod(p, [])!.cause).toBe("image-pull");
  });

  it.each(["CreateContainerConfigError", "CreateContainerError"])("%s quotes the kubelet message", (reason) => {
    const e = explainPod(waiting(reason, 'secret "db" not found'), [])!;
    expect(e.cause).toBe("container-config");
    expect(e.diagnosis).toMatch(/secret "db" not found/);
  });

  it("Unschedulable shows the scheduler message", () => {
    const p = pod({ phase: "Pending", conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable", message: "0/3 nodes are available: 3 Insufficient cpu." }] });
    const e = explainPod(p, [])!;
    expect(e.cause).toBe("unschedulable");
    expect(e.diagnosis).toMatch(/0\/3 nodes are available: 3 Insufficient cpu\./);
    expect(e.steps.some((s) => s.action.kind === "yaml")).toBe(true);
    expect(e.cites).toMatch(/PodScheduled/);
  });

  it("Pending with unbound PVC links the claim named in the message", () => {
    const p = pod({ phase: "Pending", conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable", message: '0/3 nodes are available: persistentvolumeclaim "data" not found.' }] }, {
      volumes: [{ name: "d", persistentVolumeClaim: { claimName: "data" } }],
    });
    const e = explainPod(p, [])!;
    expect(e.cause).toBe("pvc-unbound");
    const link = e.steps.find((s) => s.action.kind === "resource")!;
    expect(link.action).toEqual({ kind: "resource", resource: "persistentvolumeclaims", ns: "prod", name: "data" });
  });

  it("unbound immediate PVCs with one claim volume links it as likely", () => {
    const p = pod({ phase: "Pending", conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable", message: "0/3 nodes are available: pod has unbound immediate PersistentVolumeClaims." }] }, {
      volumes: [{ name: "d", persistentVolumeClaim: { claimName: "data" } }],
    });
    const e = explainPod(p, [])!;
    expect(e.cause).toBe("pvc-unbound");
    expect(e.diagnosis).toMatch(/likely/i);
    expect(e.steps.find((s) => s.action.kind === "resource")).toBeTruthy();
  });

  it("unbound PVC with several claims links none rather than guessing", () => {
    const p = pod({ phase: "Pending", conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable", message: "pod has unbound immediate PersistentVolumeClaims" }] }, {
      volumes: [{ name: "a", persistentVolumeClaim: { claimName: "a" } }, { name: "b", persistentVolumeClaim: { claimName: "b" } }],
    });
    const e = explainPod(p, [])!;
    expect(e.cause).toBe("pvc-unbound");
    expect(e.steps.find((s) => s.action.kind === "resource")).toBeUndefined();
  });

  it("failing liveness probe from events, only on a pod that is not ready", () => {
    const ev: PodEvent[] = [{ type: "Warning", reason: "Unhealthy", message: "Liveness probe failed: HTTP probe failed with statuscode: 500" }];
    const okNow = pod({ phase: "Running", containerStatuses: [{ name: "app", ready: true, restartCount: 2, state: { running: {} } }], conditions: [ready] });
    const notReady = pod({ phase: "Running", conditions: [notReadyCond], containerStatuses: [{ name: "app", ready: false, restartCount: 2, state: { running: {} } }] });
    expect(explainPod(okNow, ev)).toBeNull();
    const e = explainPod(notReady, ev)!;
    expect(e.cause).toBe("probe-failing");
    expect(e.diagnosis).toMatch(/Liveness probe failed: HTTP probe failed with statuscode: 500/);
    expect(e.cites).toMatch(/Unhealthy/);
    expect(e.steps.some((s) => s.action.kind === "yaml")).toBe(true);
  });

  it("readiness probe event on a not ready pod", () => {
    const notReady = pod({ phase: "Running", conditions: [notReadyCond], containerStatuses: [{ name: "app", ready: false, restartCount: 0, state: { running: {} } }] });
    const e = explainPod(notReady, [{ type: "Warning", reason: "Unhealthy", message: "Readiness probe failed: connection refused" }])!;
    expect(e.cause).toBe("probe-failing");
    expect(e.diagnosis).toMatch(/Readiness probe failed/);
  });

  it("Evicted uses the status message and links the node", () => {
    const p = pod({ phase: "Failed", reason: "Evicted", message: "The node was low on resource: memory." });
    const e = explainPod(p, [])!;
    expect(e.cause).toBe("evicted");
    expect(e.diagnosis).toMatch(/low on resource: memory/);
    expect(e.steps.some((s) => s.action.kind === "resource" && s.action.resource === "nodes" && s.action.name === "node-a")).toBe(true);
  });

  it("node NotReady from a NodeNotReady event or a NodeLost reason links the node", () => {
    const p = pod({ phase: "Running", conditions: [notReadyCond], containerStatuses: [{ name: "app", ready: false, state: { running: {} } }] });
    const e = explainPod(p, [{ type: "Warning", reason: "NodeNotReady", message: "Node is not ready" }])!;
    expect(e.cause).toBe("node-not-ready");
    expect(e.steps.some((s) => s.action.kind === "resource" && s.action.resource === "nodes")).toBe(true);
    const lost = explainPod(pod({ phase: "Failed", reason: "NodeLost", message: "Node node-a which was running pod web-1 is unresponsive" }), [])!;
    expect(lost.cause).toBe("node-not-ready");
  });

  it("a container that exited non-zero in a Failed pod", () => {
    const p = pod({ phase: "Failed", containerStatuses: [{ name: "app", ready: false, state: { terminated: { reason: "Error", exitCode: 2 } } }] });
    const e = explainPod(p, [])!;
    expect(e.cause).toBe("exited");
    expect(e.diagnosis).toMatch(/exit code 2/);
    expect(e.steps[0]!.action).toEqual({ kind: "logs", container: "app", previous: false });
  });

  it("unhealthy with no known cause says so and never invents one", () => {
    const p = pod({ phase: "Running", conditions: [notReadyCond], containerStatuses: [{ name: "app", ready: false, restartCount: 0, state: { running: {} } }] });
    const e = explainPod(p, [])!;
    expect(e.cause).toBe("unknown");
    expect(e.diagnosis).toMatch(/no known cause/i);
  });

  it("never gives more than 3 steps", () => {
    const e = explainPod(waiting("CrashLoopBackOff", "", { lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } } }), [])!;
    expect(e.steps.length).toBeLessThanOrEqual(3);
  });

  it("priority: OOMKilled beats a crash loop", () => {
    const p = waiting("CrashLoopBackOff", "", { lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } } });
    expect(explainPod(p, [])!.cause).toBe("oom-killed");
  });
});
