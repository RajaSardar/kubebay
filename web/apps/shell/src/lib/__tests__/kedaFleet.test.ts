import { describe, it, expect } from "vitest";
import { authUsers, detectKeda } from "../keda";
import type { CRDEntry } from "../api";

function crd(group: string, resource: string, gvr: string): CRDEntry {
  return { name: `${resource}.${group}`, group, version: "v1alpha1", resource, kind: resource, namespaced: true, gvr, columns: [] };
}

describe("detectKeda", () => {
  it("reports not installed when no keda.sh CRDs are discovered", () => {
    expect(detectKeda([]).installed).toBe(false);
  });

  it("detects the ScaledObject GVR and reports installed", () => {
    const crds = [crd("keda.sh", "scaledobjects", "keda.sh/v1alpha1/scaledobjects")];
    const d = detectKeda(crds);
    expect(d.installed).toBe(true);
    expect(d.gvrs.scaledobjects).toBe("keda.sh/v1alpha1/scaledobjects");
  });

  it("also picks up ScaledJob, TriggerAuthentication and ClusterTriggerAuthentication GVRs when present", () => {
    const crds = [
      crd("keda.sh", "scaledobjects", "keda.sh/v1alpha1/scaledobjects"),
      crd("keda.sh", "scaledjobs", "keda.sh/v1alpha1/scaledjobs"),
      crd("keda.sh", "triggerauthentications", "keda.sh/v1alpha1/triggerauthentications"),
      crd("keda.sh", "clustertriggerauthentications", "keda.sh/v1alpha1/clustertriggerauthentications"),
    ];
    const d = detectKeda(crds);
    expect(d.gvrs).toEqual({
      scaledobjects: "keda.sh/v1alpha1/scaledobjects",
      scaledjobs: "keda.sh/v1alpha1/scaledjobs",
      triggerauthentications: "keda.sh/v1alpha1/triggerauthentications",
      clustertriggerauthentications: "keda.sh/v1alpha1/clustertriggerauthentications",
    });
  });

  it("does not report installed from an unrelated CRD in a different group", () => {
    const crds = [crd("karpenter.sh", "nodepools", "karpenter.sh/v1/nodepools")];
    expect(detectKeda(crds).installed).toBe(false);
  });
});

function scaledObject(ns: string, authRefs: { name: string; kind?: string }[]) {
  return {
    metadata: { namespace: ns, name: "so-1" },
    spec: {
      scaleTargetRef: { name: "app", kind: "Deployment" },
      triggers: authRefs.map((r) => ({ type: "prometheus", authenticationRef: { name: r.name, kind: r.kind } })),
    },
  };
}

function triggerAuth(ns: string, name: string) {
  return { metadata: { namespace: ns, name } };
}

function clusterTriggerAuth(name: string) {
  return { metadata: { name } };
}

// The KEDA page's In use column: how many ScaledObjects and ScaledJobs
// reference an authentication. 0 is one left over from a removed ScaledObject.
describe("authUsers", () => {
  it("counts the ScaledObjects in its namespace that reference a TriggerAuthentication", () => {
    expect(authUsers(triggerAuth("prod", "vault-auth"), false, [scaledObject("prod", [{ name: "vault-auth" }])])).toBe(1);
  });

  it("is 0 for one nothing references", () => {
    expect(authUsers(triggerAuth("prod", "unused-auth"), false, [])).toBe(0);
  });

  it("doesn't count a same-named reference from another namespace", () => {
    expect(authUsers(triggerAuth("prod", "vault-auth"), false, [scaledObject("staging", [{ name: "vault-auth" }])])).toBe(0);
  });

  it("counts a ClusterTriggerAuthentication referenced with its kind, from any namespace", () => {
    const users = [scaledObject("prod", [{ name: "shared-auth", kind: "ClusterTriggerAuthentication" }]), scaledObject("dev", [{ name: "shared-auth", kind: "ClusterTriggerAuthentication" }])];
    expect(authUsers(clusterTriggerAuth("shared-auth"), true, users)).toBe(2);
  });

  it("doesn't count a TriggerAuthentication reference as one to a ClusterTriggerAuthentication of the same name", () => {
    expect(authUsers(clusterTriggerAuth("shared-auth"), true, [scaledObject("prod", [{ name: "shared-auth" }])])).toBe(0);
  });

  it("counts a ScaledObject once however many of its triggers use it, and ignores triggers without a reference", () => {
    const so = scaledObject("prod", [{ name: "vault-auth" }, { name: "vault-auth" }]);
    const bare = { metadata: { namespace: "prod", name: "so-2" }, spec: { triggers: [{ type: "cpu" }] } };
    expect(authUsers(triggerAuth("prod", "vault-auth"), false, [so, bare])).toBe(1);
  });
});
