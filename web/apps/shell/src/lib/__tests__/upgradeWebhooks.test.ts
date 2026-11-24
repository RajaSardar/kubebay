import { describe, it, expect } from "vitest";
import { webhookFindings } from "../upgradeWebhooks";

type O = Record<string, unknown>;
const cfg = (name: string, webhooks: O[]): O => ({ metadata: { name }, webhooks });
const hook = (extra: O = {}): O => ({
  name: "h.example.com",
  clientConfig: { service: { namespace: "sys", name: "svc" } },
  namespaceSelector: { matchExpressions: [{ key: "kubernetes.io/metadata.name", operator: "NotIn", values: ["kube-system", "sys"] }] },
  ...extra,
});
const eps = (ns: string, name: string, ready: boolean): O => ({
  metadata: { namespace: ns, name },
  subsets: ready ? [{ addresses: [{ ip: "10.0.0.1" }] }] : [{ notReadyAddresses: [{ ip: "10.0.0.1" }] }],
});
const kinds = (f: { kind: string }[]) => f.map((x) => x.kind).sort();

describe("webhookFindings", () => {
  it("is quiet for a healthy, scoped webhook", () => {
    expect(webhookFindings({ validating: [cfg("v", [hook()])], mutating: [], endpoints: [eps("sys", "svc", true)] })).toEqual([]);
  });
  it("flags a Fail webhook whose service has no ready endpoints, or no Endpoints object", () => {
    for (const endpoints of [[eps("sys", "svc", false)], []]) {
      const f = webhookFindings({ validating: [cfg("v", [hook()])], mutating: [], endpoints });
      expect(kinds(f)).toEqual(["no-ready-endpoints"]);
      expect(f[0]).toMatchObject({ configKind: "ValidatingWebhookConfiguration", config: "v", failurePolicy: "Fail" });
    }
  });
  it("treats a missing failurePolicy as Fail (the v1 default) but ignores Ignore", () => {
    expect(kinds(webhookFindings({ validating: [cfg("v", [hook()])], mutating: [], endpoints: [] }))).toEqual(["no-ready-endpoints"]);
    expect(webhookFindings({ validating: [cfg("v", [hook({ failurePolicy: "Ignore" })])], mutating: [], endpoints: [] })).toEqual([]);
  });
  it("skips the endpoint check when endpoints are not loaded or the webhook uses a URL", () => {
    expect(webhookFindings({ validating: [cfg("v", [hook()])], mutating: [], endpoints: undefined })).toEqual([]);
    expect(webhookFindings({ validating: [cfg("v", [hook({ clientConfig: { url: "https://x" } })])], mutating: [], endpoints: [] })).toEqual([]);
  });
  it("flags a webhook with no namespaceSelector as matching kube-system and its own namespace", () => {
    const f = webhookFindings({ mutating: [cfg("m", [hook({ namespaceSelector: undefined })])], validating: [], endpoints: [eps("sys", "svc", true)] });
    expect(kinds(f)).toEqual(["matches-kube-system", "no-self-exclusion"]);
    expect(f[0]!.configKind).toBe("MutatingWebhookConfiguration");
  });
  it("an empty namespaceSelector matches everything too", () => {
    expect(kinds(webhookFindings({ validating: [cfg("v", [hook({ namespaceSelector: {} })])], mutating: [], endpoints: [eps("sys", "svc", true)] }))).toEqual(["matches-kube-system", "no-self-exclusion"]);
  });
  it("a selector that excludes only kube-system still flags self-exclusion", () => {
    const ns = { matchExpressions: [{ key: "kubernetes.io/metadata.name", operator: "NotIn", values: ["kube-system"] }] };
    expect(kinds(webhookFindings({ validating: [cfg("v", [hook({ namespaceSelector: ns })])], mutating: [], endpoints: [eps("sys", "svc", true)] }))).toEqual(["no-self-exclusion"]);
  });
  it("flags a high timeout regardless of failurePolicy", () => {
    const f = webhookFindings({ validating: [cfg("v", [hook({ timeoutSeconds: 30, failurePolicy: "Ignore" })])], mutating: [], endpoints: [] });
    expect(kinds(f)).toEqual(["high-timeout"]);
    expect(webhookFindings({ validating: [cfg("v", [hook({ timeoutSeconds: 10 })])], mutating: [], endpoints: [eps("sys", "svc", true)] })).toEqual([]);
  });
  it("tolerates configs without webhooks", () => {
    expect(webhookFindings({ validating: [{ metadata: { name: "x" } }], mutating: [], endpoints: [] })).toEqual([]);
  });
});
