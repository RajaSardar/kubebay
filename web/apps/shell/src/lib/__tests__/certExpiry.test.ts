import { describe, expect, it } from "vitest";
import { certificateState } from "../certExpiry";
import { computeBestPractices } from "../bestPractices";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const day = 86_400_000;
const cert = (o: { ready?: boolean; notAfter?: number; noConds?: boolean }) => ({
  metadata: { name: "c", namespace: "app" },
  status: {
    notAfter: o.notAfter === undefined ? undefined : new Date(o.notAfter).toISOString(),
    conditions: o.noConds ? [] : [{ type: "Ready", status: o.ready === false ? "False" : "True" }],
  },
});

describe("certificateState", () => {
  it("is ok for a Ready certificate far from expiry", () => {
    expect(certificateState(cert({ notAfter: NOW + 60 * day }), NOW)).toBe("ok");
  });
  it("is expired once notAfter has passed", () => {
    expect(certificateState(cert({ notAfter: NOW - day }), NOW)).toBe("expired");
  });
  it("is expiring within 14 days", () => {
    expect(certificateState(cert({ notAfter: NOW + 5 * day }), NOW)).toBe("expiring");
  });
  it("is not-ready when the Ready condition is not True and it has not expired", () => {
    expect(certificateState(cert({ ready: false, notAfter: NOW + 60 * day }), NOW)).toBe("not-ready");
    expect(certificateState(cert({ noConds: true }), NOW)).toBe("not-ready");
  });
  it("expired wins over not-ready", () => {
    expect(certificateState(cert({ ready: false, notAfter: NOW - day }), NOW)).toBe("expired");
  });
});

describe("best-practice cert-expiry regression", () => {
  it("still flags the same certificates as before the refactor", () => {
    const certs = [cert({ notAfter: NOW + 60 * day }), { ...cert({ notAfter: NOW + 2 * day }), metadata: { name: "soon", namespace: "app" } }];
    const checks = computeBestPractices({
      deployments: [], statefulsets: [], pdbs: [], networkPolicies: [], namespaces: [], ingressClasses: [],
      apiGroups: ["cert-manager.io"], certificates: certs, now: NOW,
    });
    const c = checks.find((k) => k.id === "cert-expiry")!;
    expect(c.status).toBe("fail");
    expect(c.allOffenders).toEqual(["app/soon"]);
  });
});
