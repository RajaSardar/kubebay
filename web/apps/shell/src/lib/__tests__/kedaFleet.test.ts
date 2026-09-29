import { describe, it, expect } from "vitest";
import { detectKeda, findOrphanedTriggerAuths } from "../keda";
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
    expect(d.scaledObjectGvr).toBe("keda.sh/v1alpha1/scaledobjects");
  });

  it("also picks up TriggerAuthentication and ClusterTriggerAuthentication GVRs when present", () => {
    const crds = [
      crd("keda.sh", "scaledobjects", "keda.sh/v1alpha1/scaledobjects"),
      crd("keda.sh", "triggerauthentications", "keda.sh/v1alpha1/triggerauthentications"),
      crd("keda.sh", "clustertriggerauthentications", "keda.sh/v1alpha1/clustertriggerauthentications"),
    ];
    const d = detectKeda(crds);
    expect(d.triggerAuthGvr).toBe("keda.sh/v1alpha1/triggerauthentications");
    expect(d.clusterTriggerAuthGvr).toBe("keda.sh/v1alpha1/clustertriggerauthentications");
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

describe("findOrphanedTriggerAuths", () => {
  it("does not flag a TriggerAuthentication referenced by a ScaledObject in the same namespace", () => {
    const orphans = findOrphanedTriggerAuths(
      [scaledObject("prod", [{ name: "vault-auth" }])],
      [triggerAuth("prod", "vault-auth")],
      [],
    );
    expect(orphans).toEqual([]);
  });

  it("flags a TriggerAuthentication no ScaledObject references", () => {
    const orphans = findOrphanedTriggerAuths([], [triggerAuth("prod", "unused-auth")], []);
    expect(orphans).toEqual([{ name: "unused-auth", ns: "prod", scoped: true }]);
  });

  it("does not treat a same-named TriggerAuthentication in a different namespace as used", () => {
    const orphans = findOrphanedTriggerAuths(
      [scaledObject("staging", [{ name: "vault-auth" }])],
      [triggerAuth("prod", "vault-auth")],
      [],
    );
    expect(orphans).toEqual([{ name: "vault-auth", ns: "prod", scoped: true }]);
  });

  it("does not flag a ClusterTriggerAuthentication referenced with kind ClusterTriggerAuthentication", () => {
    const orphans = findOrphanedTriggerAuths(
      [scaledObject("prod", [{ name: "shared-auth", kind: "ClusterTriggerAuthentication" }])],
      [],
      [clusterTriggerAuth("shared-auth")],
    );
    expect(orphans).toEqual([]);
  });

  it("flags an unreferenced ClusterTriggerAuthentication with scoped:false", () => {
    const orphans = findOrphanedTriggerAuths([], [], [clusterTriggerAuth("unused-cluster-auth")]);
    expect(orphans).toEqual([{ name: "unused-cluster-auth", ns: "", scoped: false }]);
  });

  it("ignores triggers with no authenticationRef at all", () => {
    const so = { metadata: { namespace: "prod", name: "so-1" }, spec: { triggers: [{ type: "cpu" }] } };
    const orphans = findOrphanedTriggerAuths([so], [triggerAuth("prod", "unused")], []);
    expect(orphans).toEqual([{ name: "unused", ns: "prod", scoped: true }]);
  });
});
