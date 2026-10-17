import { afterEach, describe, expect, it, vi } from "vitest";
import { updatesApi, type UpdateStatus } from "../updates";

type W = { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } };

function desktop(invoke: (cmd: string, args?: unknown) => Promise<unknown>) {
  (window as unknown as W).__TAURI_INTERNALS__ = { invoke: vi.fn(invoke) };
  return (window as unknown as W).__TAURI_INTERNALS__!.invoke as ReturnType<typeof vi.fn>;
}

const ready: UpdateStatus = { state: "ready", version: "0.8.1", notes: null, currentVersion: "0.8.0", autoCheck: true };

afterEach(() => {
  delete (window as unknown as W).__TAURI_INTERNALS__;
});

describe("updatesApi (KB-04)", () => {
  it("does nothing in a browser tab: there is no updater there", async () => {
    expect(updatesApi.available()).toBe(false);
    await expect(updatesApi.status()).resolves.toBeNull();
    await expect(updatesApi.install()).rejects.toThrow(/desktop app/);
  });

  it("asks the desktop app for the updater's state", async () => {
    const invoke = desktop(async () => ready);
    expect(updatesApi.available()).toBe(true);
    await expect(updatesApi.status()).resolves.toEqual(ready);
    expect(invoke).toHaveBeenCalledWith("update_status", {});
  });

  it("turns checks on or off, checks now, and installs", async () => {
    const invoke = desktop(async () => ready);
    await updatesApi.setChecks(false);
    expect(invoke).toHaveBeenCalledWith("set_update_checks", { enabled: false });
    await updatesApi.checkNow();
    expect(invoke).toHaveBeenCalledWith("check_for_updates", {});
    await updatesApi.install();
    expect(invoke).toHaveBeenCalledWith("install_update", {});
  });

  it("passes on why the app didn't restart", async () => {
    desktop(async () => {
      throw "Kubebay didn't restart: 1 terminal session would be cut off. Restart when it's finished.";
    });
    await expect(updatesApi.install()).rejects.toThrow("1 terminal session would be cut off");
  });
});
