import { describe, it, expect } from "vitest";
import { helmReleaseOf, helmReleaseHref } from "../helmOwner";

const obj = (labels: Record<string, string>, annotations: Record<string, string> = {}, namespace = "shop") => ({
  metadata: { namespace, labels, annotations },
});

describe("helmReleaseOf", () => {
  it("reads the release from the Helm annotations", () => {
    const o = obj(
      { "app.kubernetes.io/managed-by": "Helm" },
      { "meta.helm.sh/release-name": "redis", "meta.helm.sh/release-namespace": "data" },
    );
    expect(helmReleaseOf(o)).toEqual({ name: "redis", namespace: "data" });
  });

  it("falls back to the instance label and the object's namespace", () => {
    const o = obj({ "app.kubernetes.io/managed-by": "Helm", "app.kubernetes.io/instance": "api" });
    expect(helmReleaseOf(o)).toEqual({ name: "api", namespace: "shop" });
  });

  it("is null when not managed by Helm", () => {
    expect(helmReleaseOf(obj({ "app.kubernetes.io/managed-by": "kustomize" }, { "meta.helm.sh/release-name": "x" }))).toBeNull();
    expect(helmReleaseOf({})).toBeNull();
  });

  it("is null when Helm-managed but no release name is recoverable", () => {
    expect(helmReleaseOf(obj({ "app.kubernetes.io/managed-by": "Helm" }))).toBeNull();
  });

  it("builds a deep link to the release's page", () => {
    expect(helmReleaseHref({ name: "redis", namespace: "data" })).toBe("/helm?release=data%2Fredis");
  });
});
