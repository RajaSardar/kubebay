import { describe, it, expect } from "vitest";
import { evalPrinterPath } from "../printerPath";

const nodePool = {
  metadata: { name: "default" },
  spec: { limits: { cpu: "1000" }, disruption: { consolidationPolicy: "WhenEmpty" } },
  status: {
    conditions: [
      { type: "ValidationSucceeded", status: "True" },
      { type: "Ready", status: "False", reason: "NodeClassNotReady" },
    ],
    resources: { cpu: "12" },
    replicas: 3,
    paused: false,
  },
};

describe("evalPrinterPath", () => {
  it("walks a plain dot path", () => {
    expect(evalPrinterPath(".metadata.name", nodePool)).toBe("default");
    expect(evalPrinterPath(".spec.disruption.consolidationPolicy", nodePool)).toBe("WhenEmpty");
  });

  it("strips the surrounding braces kubectl-style paths carry", () => {
    expect(evalPrinterPath("{.status.resources.cpu}", nodePool)).toBe("12");
  });

  it("resolves a filter predicate against a conditions array", () => {
    expect(evalPrinterPath('.status.conditions[?(@.type=="Ready")].status', nodePool)).toBe("False");
    expect(evalPrinterPath('.status.conditions[?(@.type=="Ready")].reason', nodePool)).toBe(
      "NodeClassNotReady",
    );
  });

  it("accepts single-quoted filter values", () => {
    expect(evalPrinterPath(".status.conditions[?(@.type=='ValidationSucceeded')].status", nodePool)).toBe(
      "True",
    );
  });

  it("returns the whole matched element when the path ends at the filter", () => {
    expect(evalPrinterPath('.status.conditions[?(@.status=="True")]', nodePool)).toBe(
      JSON.stringify({ type: "ValidationSucceeded", status: "True" }),
    );
  });

  it("returns empty when no array element matches", () => {
    expect(evalPrinterPath('.status.conditions[?(@.type=="Drifted")].status', nodePool)).toBe("");
  });

  it("returns empty when the filtered value is not an array", () => {
    expect(evalPrinterPath('.spec.limits[?(@.type=="Ready")].status', nodePool)).toBe("");
  });

  it("returns empty for a missing path rather than throwing", () => {
    expect(evalPrinterPath(".status.nope.deeper", nodePool)).toBe("");
    expect(evalPrinterPath(".spec.limits.cpu.deeper", nodePool)).toBe("");
  });

  it("renders booleans the way kubectl does", () => {
    expect(evalPrinterPath(".status.paused", nodePool)).toBe("False");
  });

  it("stringifies numbers", () => {
    expect(evalPrinterPath(".status.replicas", nodePool)).toBe("3");
  });

  it("rejects paths it does not understand instead of guessing", () => {
    expect(evalPrinterPath("status.replicas", nodePool)).toBe("");
    expect(evalPrinterPath(".status.conditions[*].status", nodePool)).toBe("");
    expect(evalPrinterPath(".a..b", nodePool)).toBe("");
    expect(evalPrinterPath("", nodePool)).toBe("");
  });

  // KB-13: extension columns use the same evaluator, and the columns people
  // want most are an image and a label whose key has dots in it.
  it("reads an array element by index", () => {
    expect(evalPrinterPath(".status.conditions[1].reason", nodePool)).toBe("NodeClassNotReady");
    expect(evalPrinterPath(".status.conditions[0].status", nodePool)).toBe("True");
    expect(evalPrinterPath(".status.conditions[5].status", nodePool)).toBe("");
    expect(evalPrinterPath(".spec.limits[0]", nodePool)).toBe("");
  });

  it("reads a key with dots in it when they are escaped", () => {
    const pod = { metadata: { labels: { "app.kubernetes.io/name": "api", app: "x" } } };
    expect(evalPrinterPath(".metadata.labels.app\\.kubernetes\\.io/name", pod)).toBe("api");
    expect(evalPrinterPath("{.metadata.labels.app\\.kubernetes\\.io/name}", pod)).toBe("api");
    expect(evalPrinterPath(".metadata.labels.app", pod)).toBe("x");
  });
});
