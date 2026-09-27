import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "../api";
import { PolicyRejectionError } from "../policyRejection";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(status: number, body: string) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

const applyArgs = { cluster: "kind-test", gvr: "v1/configmaps", ns: "default", name: "example", yaml: "kind: ConfigMap", dryRun: true, force: false };

describe("api.applyYaml", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed body on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { applied: true, dryRun: true })));
    const r = await api.applyYaml(applyArgs);
    expect(r.applied).toBe(true);
  });

  it("throws a PolicyRejectionError with structured detail on a 422 policy rejection", async () => {
    const policyRejection = { engine: "kyverno", webhook: "validate.kyverno.svc-fail", message: "label 'team' is required", causes: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(422, { error: "policy-rejected", policyRejection })),
    );
    await expect(api.applyYaml(applyArgs)).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(PolicyRejectionError);
      expect((e as PolicyRejectionError).rejection).toEqual(policyRejection);
      return true;
    });
  });

  it("falls back to a plain Error for a non-policy failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(502, "apply: connection refused")));
    await expect(api.applyYaml(applyArgs)).rejects.toThrow("apply: connection refused");
  });
});
