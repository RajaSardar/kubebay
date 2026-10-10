import { describe, it, expect, vi, afterEach } from "vitest";
import { api, mcpApi, triageApi } from "../api";
import { PolicyRejectionError, StaleEditError } from "../policyRejection";

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

describe("api — policy rejection now surfaces on every mutating call, not just applyYaml (backlog #17)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const policyRejection = { engine: "kyverno", webhook: "validate.kyverno.svc-fail", message: "label 'team' is required", causes: [] };

  it("api.scale throws a PolicyRejectionError on a 422 policy rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(422, { error: "policy-rejected", policyRejection })));
    await expect(api.scale({ cluster: "kind-test", gvr: "apps/v1/deployments", ns: "default", name: "web", replicas: 3 })).rejects.toBeInstanceOf(
      PolicyRejectionError,
    );
  });

  it("api.deleteResource throws a PolicyRejectionError on a 422 policy rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(422, { error: "policy-rejected", policyRejection })));
    await expect(
      api.deleteResource({ cluster: "kind-test", gvr: "v1/pods", ns: "default", name: "web" }),
    ).rejects.toBeInstanceOf(PolicyRejectionError);
  });

  it("api.createResource throws a PolicyRejectionError on a 422 policy rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(422, { error: "policy-rejected", policyRejection })));
    await expect(api.createResource({ cluster: "kind-test", yaml: "kind: ConfigMap", dryRun: false })).rejects.toBeInstanceOf(
      PolicyRejectionError,
    );
  });

  it("a plain send() call still throws a normal Error for a non-policy failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(502, "connection refused")));
    await expect(api.scale({ cluster: "kind-test", gvr: "apps/v1/deployments", ns: "default", name: "web", replicas: 3 })).rejects.toThrow(
      "connection refused",
    );
  });
});

describe("api.applyYaml — stale edits", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws a StaleEditError naming the fields that changed on the cluster since load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { error: "changed-since-load", paths: ["spec.replicas"], message: "these fields changed" })),
    );
    await expect(api.applyYaml(applyArgs)).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(StaleEditError);
      expect((e as StaleEditError).paths).toEqual(["spec.replicas"]);
      return true;
    });
  });

  it("keeps a plain-text 409 (an API server conflict) as an ordinary Error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(409, "Operation cannot be fulfilled")));
    await expect(api.applyYaml(applyArgs)).rejects.toSatisfy((e: unknown) => {
      expect(e).not.toBeInstanceOf(StaleEditError);
      expect((e as Error).message).toBe("Operation cannot be fulfilled");
      return true;
    });
  });
});

describe("mcpApi (backlog #5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads, saves and rotates through the token-guarded settings routes", async () => {
    const status = { enabled: true, clusters: { "kind-dev": [] }, url: "http://127.0.0.1:9898/mcp", bridgeCommand: ["/kb", "mcp-stdio"] };
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, status));
    vi.stubGlobal("fetch", fetchMock);
    expect((await mcpApi.get()).bridgeCommand).toEqual(["/kb", "mcp-stdio"]);
    await mcpApi.save({ enabled: true, clusters: { "kind-dev": ["shop"] } });
    await mcpApi.rotate();
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit | undefined)?.method ?? "GET", (init as RequestInit | undefined)?.body]);
    expect(calls).toEqual([
      ["/api/mcp", "GET", undefined],
      ["/api/mcp", "POST", JSON.stringify({ enabled: true, clusters: { "kind-dev": ["shop"] } })],
      ["/api/mcp/rotate", "POST", undefined],
    ]);
  });
});

describe("triageApi (backlog #13)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the token-guarded triage routes; the key goes in a PUT body only", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, { enabled: false, clusters: [], baseURL: "", model: "", key: { source: "", store: "" } }));
    vi.stubGlobal("fetch", fetchMock);
    await triageApi.get();
    await triageApi.save({ enabled: true, clusters: ["kind-dev"], baseURL: "", model: "" });
    await triageApi.putKey("sk-ant-api03-abc");
    await triageApi.deleteKey();
    await triageApi.preview({ cluster: "kind-dev", namespace: "shop", pod: "api-7d9-x" });
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit | undefined)?.method ?? "GET", (init as RequestInit | undefined)?.body]);
    expect(calls).toEqual([
      ["/api/triage", "GET", undefined],
      ["/api/triage", "POST", JSON.stringify({ enabled: true, clusters: ["kind-dev"], baseURL: "", model: "" })],
      ["/api/triage/key", "PUT", JSON.stringify({ key: "sk-ant-api03-abc" })],
      ["/api/triage/key", "DELETE", undefined],
      ["/api/triage/preview", "POST", JSON.stringify({ cluster: "kind-dev", namespace: "shop", pod: "api-7d9-x" })],
    ]);
  });
});
