import { describe, it, expect } from "vitest";
import { detectArgoEvents, conditionState, summarizeEventSource, summarizeSensor, summarizeEventBus } from "../argoEvents";
import type { CRDEntry } from "../api";

function crd(resource: string, kind: string, group = "argoproj.io"): CRDEntry {
  return { name: `${resource}.${group}`, group, version: "v1alpha1", resource, kind, namespaced: true, gvr: `${group}/v1alpha1/${resource}`, columns: [] };
}

describe("detectArgoEvents", () => {
  it("is not installed with only other argoproj.io CRDs", () => {
    expect(detectArgoEvents([crd("applications", "Application"), crd("workflows", "Workflow")]).installed).toBe(false);
  });
  it("finds EventSources, Sensors and EventBus", () => {
    expect(detectArgoEvents([crd("eventsources", "EventSource"), crd("sensors", "Sensor"), crd("eventbus", "EventBus")])).toEqual({
      installed: true,
      eventSourceGvr: "argoproj.io/v1alpha1/eventsources",
      sensorGvr: "argoproj.io/v1alpha1/sensors",
      eventBusGvr: "argoproj.io/v1alpha1/eventbus",
    });
  });
  it("one kind alone counts as installed", () => {
    expect(detectArgoEvents([crd("sensors", "Sensor")]).installed).toBe(true);
  });
});

describe("conditionState", () => {
  const o = (conditions?: unknown[]) => ({ status: conditions ? { conditions } : {} });
  it("Ready when every condition is True", () => {
    expect(conditionState(o([{ type: "Deployed", status: "True" }, { type: "SourcesProvided", status: "True" }]))).toMatchObject({ state: "Ready" });
  });
  it("Not ready with the message of the first failing condition", () => {
    const s = conditionState(o([{ type: "Deployed", status: "True" }, { type: "TriggersProvided", status: "False", message: "bad trigger" }]));
    expect(s).toMatchObject({ state: "Not ready", message: "bad trigger" });
  });
  it("Unknown with no conditions", () => {
    expect(conditionState(o())).toMatchObject({ state: "Unknown", conditions: [] });
  });
  it("Unknown when a condition is still Unknown", () => {
    expect(conditionState(o([{ type: "Deployed", status: "Unknown" }])).state).toBe("Unknown");
  });
  it("lists each condition with its status", () => {
    expect(conditionState(o([{ type: "Deployed", status: "True" }])).conditions).toEqual([{ type: "Deployed", ok: true }]);
  });
});

describe("summarizeEventSource", () => {
  const es = {
    metadata: { name: "gh", namespace: "events" },
    spec: {
      eventBusName: "main",
      template: { serviceAccountName: "x" },
      service: { ports: [] },
      replicas: 1,
      webhook: { push: { port: "12000", endpoint: "/push", method: "POST" }, pr: { port: "12001" } },
      calendar: { every5: { interval: "5m" } },
    },
    status: { conditions: [{ type: "Deployed", status: "True" }] },
  };
  it("lists declared event types and names, ignoring non-source spec keys", () => {
    const s = summarizeEventSource(es);
    expect(s.events).toEqual([
      { type: "webhook", name: "push" },
      { type: "webhook", name: "pr" },
      { type: "calendar", name: "every5" },
    ]);
    expect(s.types).toEqual(["webhook", "calendar"]);
  });
  it("names the bus, defaulting to `default`", () => {
    expect(summarizeEventSource(es).bus).toBe("main");
    expect(summarizeEventSource({ metadata: { name: "a" }, spec: {} }).bus).toBe("default");
  });
  it("carries ready state", () => {
    expect(summarizeEventSource(es).state).toBe("Ready");
  });
  it("is empty when it declares nothing", () => {
    expect(summarizeEventSource({ metadata: { name: "e" } }).events).toEqual([]);
  });
});

describe("summarizeSensor", () => {
  const sensor = {
    metadata: { name: "on-push", namespace: "events" },
    spec: {
      eventBusName: "main",
      dependencies: [{ name: "dep1", eventSourceName: "gh", eventName: "push" }],
      triggers: [
        {
          template: {
            name: "run-ci",
            argoWorkflow: {
              operation: "submit",
              source: { resource: { apiVersion: "argoproj.io/v1alpha1", kind: "Workflow", metadata: { generateName: "ci-", namespace: "ci" } } },
            },
          },
        },
        { template: { name: "make-cm", k8s: { operation: "create", source: { resource: { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "cm1" } } } } } },
        { template: { name: "notify", http: { url: "https://x" } } },
        { template: { name: "from-file", k8s: { operation: "create", source: { file: { path: "/x" } } } } },
        { template: { name: "rerun", argoWorkflow: { operation: "resubmit", source: { resource: { kind: "Workflow", metadata: { name: "wf-1" } } } } } },
      ],
    },
    status: { conditions: [{ type: "Deployed", status: "True" }, { type: "TriggersProvided", status: "False", message: "bad" }] },
  };
  it("lists dependencies as eventSource/event", () => {
    expect(summarizeSensor(sensor).dependencies).toEqual([{ name: "dep1", eventSource: "gh", event: "push" }]);
  });
  it("derives each trigger's type and the kind it creates", () => {
    const t = summarizeSensor(sensor).triggers;
    expect(t[0]).toEqual({ name: "run-ci", type: "argoWorkflow", operation: "submit", targetKind: "Workflow", targetName: "ci-*", targetNs: "ci", isWorkflow: true });
    expect(t[1]).toMatchObject({ type: "k8s", operation: "create", targetKind: "ConfigMap", targetName: "cm1", isWorkflow: false });
  });
  it("a non-Kubernetes trigger has no target kind, just its type", () => {
    expect(summarizeSensor(sensor).triggers[2]).toMatchObject({ name: "notify", type: "http", targetKind: "", targetName: "" });
  });
  it("an externally sourced trigger says so with no kind", () => {
    expect(summarizeSensor(sensor).triggers[3]).toMatchObject({ type: "k8s", targetKind: "", targetName: "" });
  });
  it("a resubmit of a named workflow targets that workflow", () => {
    expect(summarizeSensor(sensor).triggers[4]).toMatchObject({ operation: "resubmit", targetKind: "Workflow", targetName: "wf-1", isWorkflow: true });
  });
  it("an argoWorkflow trigger without an inline resource is still a Workflow", () => {
    const s = summarizeSensor({ metadata: { name: "s" }, spec: { triggers: [{ template: { name: "t", argoWorkflow: { operation: "submit", source: { url: { path: "x" } } } } }] } });
    expect(s.triggers[0]).toMatchObject({ targetKind: "Workflow", targetName: "", isWorkflow: true });
  });
  it("reports state from conditions and the bus", () => {
    const s = summarizeSensor(sensor);
    expect(s.state).toBe("Not ready");
    expect(s.message).toBe("bad");
    expect(s.bus).toBe("main");
  });
  it("tolerates no triggers or dependencies", () => {
    expect(summarizeSensor({ metadata: { name: "e" } })).toMatchObject({ triggers: [], dependencies: [] });
  });
});

describe("summarizeEventBus", () => {
  it.each([
    [{ jetstream: { version: "latest", replicas: 3 } }, "jetstream", 3],
    [{ nats: { native: { replicas: 3 } } }, "nats", 3],
    [{ nats: { exotic: { url: "nats://x" } } }, "nats (external)", null],
    [{ kafka: { url: "k:9092" } }, "kafka", null],
    [{}, "unknown", null],
  ])("backend of %j", (spec, backend, replicas) => {
    const s = summarizeEventBus({ metadata: { name: "default", namespace: "events" }, spec });
    expect(s.backend).toBe(backend);
    expect(s.replicas).toBe(replicas);
  });
  it("carries the Deployed/Configured state", () => {
    const s = summarizeEventBus({ metadata: { name: "d" }, spec: {}, status: { conditions: [{ type: "Deployed", status: "True" }, { type: "Configured", status: "True" }] } });
    expect(s.state).toBe("Ready");
    expect(s.conditions.map((c) => c.type)).toEqual(["Deployed", "Configured"]);
  });
});
