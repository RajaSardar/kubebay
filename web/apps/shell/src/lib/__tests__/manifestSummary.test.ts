import { describe, it, expect } from "vitest";
import { summarizeManifestResources, countManifestKinds } from "../manifestSummary";

describe("summarizeManifestResources", () => {
  it("returns one entry per kind+name across multiple YAML docs", () => {
    const manifest = [
      "apiVersion: v1",
      "kind: ServiceAccount",
      "metadata:",
      "  name: vpa-recommender",
      "---",
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  name: vpa-recommender",
    ].join("\n");

    const rows = summarizeManifestResources(manifest);
    expect(rows).toEqual([
      { kind: "ServiceAccount", name: "vpa-recommender" },
      { kind: "Deployment", name: "vpa-recommender" },
    ]);
  });

  it("skips empty docs from leading/trailing '---' separators", () => {
    const manifest = "---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: x\n---\n";
    expect(summarizeManifestResources(manifest)).toEqual([{ kind: "Secret", name: "x" }]);
  });

  it("returns an empty list for an empty manifest", () => {
    expect(summarizeManifestResources("")).toEqual([]);
  });

  it("skips a doc missing kind or metadata.name rather than throwing", () => {
    const manifest = ["apiVersion: v1", "kind: ConfigMap", "# no metadata at all"].join("\n");
    expect(summarizeManifestResources(manifest)).toEqual([]);
  });

  it("groups counts by kind", () => {
    const manifest = [
      "kind: CustomResourceDefinition",
      "metadata:\n  name: verticalpodautoscalers.autoscaling.k8s.io",
      "---",
      "kind: CustomResourceDefinition",
      "metadata:\n  name: verticalpodautoscalercheckpoints.autoscaling.k8s.io",
    ].join("\n");
    const counts = countManifestKinds(summarizeManifestResources(manifest));
    expect(counts).toEqual({ CustomResourceDefinition: 2 });
  });
});
