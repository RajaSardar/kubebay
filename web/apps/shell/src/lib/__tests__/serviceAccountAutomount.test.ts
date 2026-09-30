import { describe, it, expect } from "vitest";
import { findDefaultServiceAccountAutomounts } from "../serviceAccountAutomount";

function pod(ns: string, name: string, labels: Record<string, string>, spec: Record<string, unknown> = {}) {
  return { metadata: { namespace: ns, name, labels }, spec };
}
function sa(ns: string, name: string, automountServiceAccountToken?: boolean) {
  return { metadata: { namespace: ns, name }, automountServiceAccountToken };
}

describe("findDefaultServiceAccountAutomounts", () => {
  it("flags a pod on the default ServiceAccount with no automount setting anywhere (K8s default is true)", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" })];
    const findings = findDefaultServiceAccountAutomounts(pods, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ namespace: "shop", appLabel: "cart" });
  });

  it("flags a pod that explicitly sets automountServiceAccountToken: true on the default SA", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }, { automountServiceAccountToken: true })];
    expect(findDefaultServiceAccountAutomounts(pods, [])).toHaveLength(1);
  });

  it("does not flag a pod that explicitly disables automount at the pod level", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }, { automountServiceAccountToken: false })];
    expect(findDefaultServiceAccountAutomounts(pods, [])).toHaveLength(0);
  });

  it("does not flag a pod when the default ServiceAccount object itself disables automount", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" })];
    const sas = [sa("shop", "default", false)];
    expect(findDefaultServiceAccountAutomounts(pods, sas)).toHaveLength(0);
  });

  it("pod-level setting overrides the ServiceAccount's own setting", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }, { automountServiceAccountToken: true })];
    const sas = [sa("shop", "default", false)];
    expect(findDefaultServiceAccountAutomounts(pods, sas)).toHaveLength(1);
  });

  it("does not flag a pod running under a non-default, explicitly named ServiceAccount", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }, { serviceAccountName: "cart-sa" })];
    expect(findDefaultServiceAccountAutomounts(pods, [])).toHaveLength(0);
  });

  it("treats an unset serviceAccountName as the default ServiceAccount, same as the API server does", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }, {})];
    expect(findDefaultServiceAccountAutomounts(pods, [])).toHaveLength(1);
  });

  it("groups by namespace+app label rather than one finding per pod", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }), pod("shop", "cart-2", { app: "cart" })];
    const findings = findDefaultServiceAccountAutomounts(pods, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ podCount: 2 });
  });

  it("only matches the ServiceAccount object in the same namespace", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" })];
    const sas = [sa("other-ns", "default", false)];
    expect(findDefaultServiceAccountAutomounts(pods, sas)).toHaveLength(1);
  });

  it("returns an empty list for no pods", () => {
    expect(findDefaultServiceAccountAutomounts([], [])).toEqual([]);
  });
});
