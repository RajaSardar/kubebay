import { describe, expect, it } from "vitest";
import { isWorkloadRoute } from "../WorkloadTabBar";

// ── isWorkloadRoute ───────────────────────────────────────────────────────────

describe("isWorkloadRoute", () => {
  it("returns true for /workloads (Pods tab)", () => {
    expect(isWorkloadRoute("/workloads")).toBe(true);
  });

  it("returns true for /workloads-overview (Overview tab)", () => {
    expect(isWorkloadRoute("/workloads-overview")).toBe(true);
  });

  it("returns true for each workload resource route", () => {
    const routes = [
      "/r/deployments",
      "/r/daemonsets",
      "/r/statefulsets",
      "/r/replicasets",
      "/r/jobs",
      "/r/cronjobs",
      "/r/replicationcontrollers",
    ];
    for (const r of routes) {
      expect(isWorkloadRoute(r)).toBe(true);
    }
  });

  it("returns false for non-workload resource routes", () => {
    expect(isWorkloadRoute("/r/services")).toBe(false);
    expect(isWorkloadRoute("/r/configmaps")).toBe(false);
    expect(isWorkloadRoute("/r/nodes")).toBe(false);
    expect(isWorkloadRoute("/r/ingresses")).toBe(false);
    expect(isWorkloadRoute("/r/persistentvolumeclaims")).toBe(false);
  });

  it("returns false for app shell routes", () => {
    expect(isWorkloadRoute("/")).toBe(false);
    expect(isWorkloadRoute("/clusters")).toBe(false);
    expect(isWorkloadRoute("/settings")).toBe(false);
    expect(isWorkloadRoute("/helm")).toBe(false);
    expect(isWorkloadRoute("/topology")).toBe(false);
    expect(isWorkloadRoute("/terminal")).toBe(false);
  });

  it("strips query string before matching — returns true when base path is a workload route", () => {
    // isWorkloadRoute is called with pathname (no query string in normal use),
    // but if a full URL is passed the split('?')[0] guard correctly handles it.
    expect(isWorkloadRoute("/workloads?cluster=prod")).toBe(true);
    expect(isWorkloadRoute("/r/deployments?cluster=prod&ns=default")).toBe(true);
    // Non-workload routes with query strings still return false
    expect(isWorkloadRoute("/r/services?cluster=prod")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isWorkloadRoute("")).toBe(false);
  });

  it("returns false for prefix-only matches (no partial match)", () => {
    // /workloads-extra should NOT match /workloads
    expect(isWorkloadRoute("/workloads-extra")).toBe(false);
    // /r/deployments-v2 should NOT match /r/deployments
    expect(isWorkloadRoute("/r/deployments-v2")).toBe(false);
  });
});

// ── Terminating pod detection ─────────────────────────────────────────────────
// The logic `!!rec(o.metadata).deletionTimestamp` is inlined in ResourceTable.tsx.
// Test it here as a pure boolean expression to guard the contract.

describe("terminating pod detection (deletionTimestamp)", () => {
  function isTerminating(o: Record<string, unknown>): boolean {
    const meta = (o.metadata ?? {}) as Record<string, unknown>;
    return !!meta.deletionTimestamp;
  }

  it("detects terminating when deletionTimestamp is a non-empty string", () => {
    expect(isTerminating({ metadata: { deletionTimestamp: "2026-09-19T12:00:00Z" } })).toBe(true);
  });

  it("returns false when deletionTimestamp is absent", () => {
    expect(isTerminating({ metadata: { name: "my-pod" } })).toBe(false);
    expect(isTerminating({ metadata: {} })).toBe(false);
  });

  it("returns false when deletionTimestamp is null", () => {
    expect(isTerminating({ metadata: { deletionTimestamp: null } })).toBe(false);
  });

  it("returns false when metadata is missing entirely", () => {
    expect(isTerminating({})).toBe(false);
  });

  it("returns true regardless of pod phase — Terminating is signalled by deletionTimestamp not phase", () => {
    // A pod can have phase=Running AND deletionTimestamp set — it is still terminating
    expect(
      isTerminating({
        metadata: { deletionTimestamp: "2026-09-19T12:00:00Z" },
        status: { phase: "Running" },
      }),
    ).toBe(true);
  });
});
