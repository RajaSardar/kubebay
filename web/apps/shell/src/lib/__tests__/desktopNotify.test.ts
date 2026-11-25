import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopNotify } from "../desktopNotify";

type W = { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } };
afterEach(() => {
  delete (window as unknown as W).__TAURI_INTERNALS__;
});

describe("desktopNotify", () => {
  it("is a safe no-op in a browser tab", async () => {
    expect(desktopNotify.available()).toBe(false);
    expect(await desktopNotify.requestPermission()).toBe("unavailable");
    await expect(desktopNotify.send({ title: "t", body: "b" })).resolves.toBeUndefined();
  });

  it("asks the desktop app for permission and sends only title and body", async () => {
    const invoke = vi.fn(async (cmd: string) => (cmd === "request_notification_permission" ? "granted" : undefined));
    (window as unknown as W).__TAURI_INTERNALS__ = { invoke };
    expect(desktopNotify.available()).toBe(true);
    expect(await desktopNotify.requestPermission()).toBe("granted");
    await desktopNotify.send({ title: "Critical issue", body: "Pod prod/api", issueId: "secret|id" });
    expect(invoke).toHaveBeenLastCalledWith("notify_issue", { title: "Critical issue", body: "Pod prod/api" });
  });

  it("reports a failed permission request as denied and swallows a failed send", async () => {
    (window as unknown as W).__TAURI_INTERNALS__ = { invoke: vi.fn().mockRejectedValue(new Error("boom")) };
    expect(await desktopNotify.requestPermission()).toBe("denied");
    await expect(desktopNotify.send({ title: "t", body: "b" })).resolves.toBeUndefined();
  });
});
