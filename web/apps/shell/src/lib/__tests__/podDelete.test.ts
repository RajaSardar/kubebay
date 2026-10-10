import { describe, it, expect } from "vitest";
import { forceDeleteEffect } from "../podDelete";

const pod = (phase: string, extra: { nodeName?: string; finalizers?: string[] } = {}) => ({
  metadata: { name: "p", ...(extra.finalizers ? { finalizers: extra.finalizers } : {}) },
  spec: { nodeName: extra.nodeName ?? "node-1" },
  status: { phase },
});

describe("forceDeleteEffect", () => {
  it("skips the grace period only for a scheduled pod that hasn't finished", () => {
    expect(forceDeleteEffect(pod("Running"))).toEqual({ skipsGrace: true, removesFinalizers: false });
    expect(forceDeleteEffect(pod("Pending"))).toEqual({ skipsGrace: true, removesFinalizers: false });
    expect(forceDeleteEffect(pod("Unknown"))).toEqual({ skipsGrace: true, removesFinalizers: false });
  });

  it("does nothing for a finished or unscheduled pod, which the API server already deletes immediately", () => {
    expect(forceDeleteEffect(pod("Succeeded"))).toEqual({ skipsGrace: false, removesFinalizers: false });
    expect(forceDeleteEffect(pod("Failed"))).toEqual({ skipsGrace: false, removesFinalizers: false });
    expect(forceDeleteEffect(pod("Pending", { nodeName: "" }))).toEqual({ skipsGrace: false, removesFinalizers: false });
  });

  it("still removes finalizers, which can hold even a finished pod (a Job's tracking finalizer)", () => {
    expect(forceDeleteEffect(pod("Succeeded", { finalizers: ["batch.kubernetes.io/job-tracking"] }))).toEqual({
      skipsGrace: false,
      removesFinalizers: true,
    });
  });

  it("assumes both apply when the pod object isn't loaded", () => {
    expect(forceDeleteEffect(undefined)).toEqual({ skipsGrace: true, removesFinalizers: true });
  });
});
