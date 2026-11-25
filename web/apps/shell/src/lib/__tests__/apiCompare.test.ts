import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ObjectNotFoundError } from "../api";

afterEach(() => vi.unstubAllGlobals());

describe("api.getObjectForCompare", () => {
  it("asks the engine for JSON with a Secret's values reduced to sizes, never a reveal", async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"kind":"Secret"}', { status: 200 }));
    vi.stubGlobal("fetch", f);
    const obj = await api.getObjectForCompare("dev", "v1/secrets", "shop", "db");
    expect(obj).toEqual({ kind: "Secret" });
    const url = String(f.mock.calls[0]![0]);
    expect(url).toContain("cluster=dev");
    expect(url).toContain("format=json");
    expect(url).toContain("mask=sizes");
    expect(url).not.toContain("reveal");
  });
  it("throws ObjectNotFoundError on 404 and the engine's text otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gone", { status: 404 })));
    await expect(api.getObjectForCompare("dev", "v1/pods", "a", "b")).rejects.toBeInstanceOf(ObjectNotFoundError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("get: forbidden", { status: 502 })));
    await expect(api.getObjectForCompare("dev", "v1/pods", "a", "b")).rejects.toThrow("forbidden");
  });
});
