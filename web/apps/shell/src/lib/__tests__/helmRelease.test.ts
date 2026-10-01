import { describe, it, expect } from "vitest";
import { helmReleaseOf } from "../gitops";

describe("helmReleaseOf", () => {
  it("reads Helm's release-name annotation", () => {
    expect(helmReleaseOf({ metadata: { annotations: { "meta.helm.sh/release-name": "api-consumers-in" } } })).toBe("api-consumers-in");
  });
  it("falls back to the managed-by label with the instance label", () => {
    expect(
      helmReleaseOf({ metadata: { labels: { "app.kubernetes.io/managed-by": "Helm", "app.kubernetes.io/instance": "web" } } }),
    ).toBe("web");
  });
  it("is null for objects Helm doesn't manage", () => {
    expect(helmReleaseOf({ metadata: { labels: { app: "x" } } })).toBeNull();
    expect(helmReleaseOf(null)).toBeNull();
  });
});
