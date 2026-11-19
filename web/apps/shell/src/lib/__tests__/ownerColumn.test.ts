import { describe, expect, it } from "vitest";
import { ownerCellOf, replicaSetOwners } from "../ownerColumn";

const obj = (ns: string, name: string, refs?: Record<string, unknown>[]) => ({
  metadata: { namespace: ns, name, ownerReferences: refs },
});
const ref = (kind: string, name: string, extra: Record<string, unknown> = {}) => ({
  kind,
  name,
  apiVersion: "apps/v1",
  controller: true,
  ...extra,
});

describe("ownerCellOf", () => {
  it("shows a bare object as a dash with no link", () => {
    const c = ownerCellOf(obj("a", "p"));
    expect(c).toMatchObject({ text: "—", kind: "" });
    expect(c.href).toBeUndefined();
  });

  it("ignores owners that are not the controller", () => {
    expect(ownerCellOf(obj("a", "p", [ref("Foo", "x", { controller: false })])).text).toBe("—");
  });

  it("shows the direct owner of a StatefulSet, DaemonSet, Job pod", () => {
    expect(ownerCellOf(obj("a", "p", [ref("StatefulSet", "db")]))).toMatchObject({
      text: "StatefulSet/db",
      kind: "StatefulSet",
      href: "/detail/statefulsets/a/db",
    });
    expect(ownerCellOf(obj("a", "p", [ref("Job", "j", { apiVersion: "batch/v1" })])).href).toBe("/detail/jobs/a/j");
  });

  it("resolves a pod's ReplicaSet to the Deployment above it", () => {
    const idx = replicaSetOwners([obj("a", "web-1", [ref("Deployment", "web")])]);
    expect(ownerCellOf(obj("a", "p", [ref("ReplicaSet", "web-1")]), idx)).toMatchObject({
      text: "Deployment/web",
      kind: "Deployment",
      href: "/detail/deployments/a/web",
    });
  });

  it("resolves a ReplicaSet owned by an Argo Rollout (a CRD) to a link the CRD page serves", () => {
    const rolloutRef = ref("Rollout", "api", { apiVersion: "argoproj.io/v1alpha1" });
    const idx = replicaSetOwners([obj("a", "api-1", [rolloutRef])]);
    const c = ownerCellOf(obj("a", "p", [ref("ReplicaSet", "api-1")]), idx);
    expect(c.text).toBe("Rollout/api");
    expect(c.href).toBe("/detail/ext--argoproj.io--v1alpha1--rollouts/a/api");
  });

  it("keeps the ReplicaSet when it is not in the index or is itself bare", () => {
    expect(ownerCellOf(obj("a", "p", [ref("ReplicaSet", "gone")]), new Map()).text).toBe("ReplicaSet/gone");
    const idx = replicaSetOwners([obj("a", "orphan")]);
    expect(ownerCellOf(obj("a", "p", [ref("ReplicaSet", "orphan")]), idx).text).toBe("ReplicaSet/orphan");
  });

  it("does not mix up same-named ReplicaSets in different namespaces", () => {
    const idx = replicaSetOwners([obj("a", "x", [ref("Deployment", "da")]), obj("b", "x", [ref("Deployment", "db")])]);
    expect(ownerCellOf(obj("b", "p", [ref("ReplicaSet", "x")]), idx).text).toBe("Deployment/db");
  });

  it("links a static pod's Node owner without a namespace", () => {
    const c = ownerCellOf(obj("kube-system", "etcd-n1", [ref("Node", "n1", { apiVersion: "v1" })]));
    expect(c).toMatchObject({ text: "Node/n1", href: "/detail/nodes/_/n1" });
  });

  it("shows a ReplicaSet row's own direct owner", () => {
    expect(ownerCellOf(obj("a", "web-1", [ref("Deployment", "web")])).text).toBe("Deployment/web");
  });
});
