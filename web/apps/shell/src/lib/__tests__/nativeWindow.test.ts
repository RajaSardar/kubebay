/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nativeAppearance, syncNativeWindow } from "../nativeWindow";
import { useTheme, type ThemeName } from "../theme";

const tokensCss = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const blocks = Object.fromEntries(
  [...tokensCss.matchAll(/(?::root,\s*)?:root\[data-theme="([\w-]+)"\]\s*\{([^}]*)\}/g)].map((m) => [m[1]!, m[2]!]),
);

function stubTauri() {
  const invoke = vi.fn().mockResolvedValue(undefined);
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke };
  return invoke;
}

afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe("nativeAppearance", () => {
  it.each(Object.entries(blocks))("%s matches its color-scheme in tokens.css", (id, body) => {
    const scheme = /color-scheme:\s*(\w+)/.exec(body)![1];
    expect(nativeAppearance(id as ThemeName)).toBe(scheme);
  });

  it("leaves the window to the OS when the user picked System", () => {
    expect(nativeAppearance("system")).toBe("system");
  });

  it.each(Object.entries(blocks))("%s has a #rrggbb theme colour the native side can parse", (_, body) => {
    expect(/--kb-theme-color:\s*([^;]+);/.exec(body)![1]!.trim()).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("syncNativeWindow", () => {
  it("does nothing in a browser tab", () => {
    expect(() => syncNativeWindow("#f2f2f7", "light")).not.toThrow();
  });

  it("tells the desktop window its background and appearance", () => {
    const invoke = stubTauri();
    syncNativeWindow(" #161617 ", "dark");
    expect(invoke).toHaveBeenCalledWith("set_window_theme", { background: "#161617", appearance: "dark" });
  });

  it("sends nothing it cannot parse", () => {
    const invoke = stubTauri();
    syncNativeWindow("rgb(1, 2, 3)", "dark");
    syncNativeWindow("", "light");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("swallows a rejected call (an engine page opened without the desktop ACL)", async () => {
    const invoke = stubTauri();
    invoke.mockRejectedValueOnce(new Error("not allowed by ACL"));
    expect(() => syncNativeWindow("#161617", "dark")).not.toThrow();
    await Promise.resolve();
  });
});

describe("theme changes reach the desktop window", () => {
  it.each([
    ["dracula", "dark"],
    ["github-light", "light"],
    ["system", "system"],
  ] as const)("choosing %s sends appearance %s with the theme colour", (theme, appearance) => {
    const invoke = stubTauri();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ getPropertyValue: () => " #123456" } as unknown as CSSStyleDeclaration);
    useTheme.getState().setTheme(theme);
    expect(invoke).toHaveBeenLastCalledWith("set_window_theme", { background: "#123456", appearance });
  });
});

describe("the desktop app accepts the call", () => {
  const tauri = resolve(__dirname, "../../../../../../desktop/src-tauri");
  // The page's whole IPC surface, exactly: set_window_theme; smoke_ready
  // (KB-14), which does nothing outside a KUBEBAY_SMOKE=1 run; and the
  // updater's four commands (KB-04).
  const commands = ["set_window_theme", "smoke_ready", "update_status", "set_update_checks", "check_for_updates", "install_update"];
  it("declares exactly its commands, callable only from the engine-served page", () => {
    const build = readFileSync(resolve(tauri, "build.rs"), "utf8");
    const declared = /commands\(&\[([^\]]*)\]\)/.exec(build)?.[1] ?? "";
    expect([...declared.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])).toEqual(commands);
    const main = readFileSync(resolve(tauri, "src/main.rs"), "utf8");
    const handled = /generate_handler!\[([^\]]*)\]/.exec(main)?.[1] ?? "";
    expect(handled.split(",").map((c) => c.trim()).filter(Boolean)).toEqual(commands);
    expect(main).toMatch(/fn smoke_ready\(\) \{\s*if !smoke::is_on\(\) \{\s*return;\s*\}/);
    const cap = JSON.parse(readFileSync(resolve(tauri, "capabilities/window-theme.json"), "utf8"));
    expect(cap).toMatchObject({ windows: ["main"], remote: { urls: ["http://127.0.0.1:*"] }, permissions: ["allow-set-window-theme"] });
    const smoke = JSON.parse(readFileSync(resolve(tauri, "capabilities/smoke.json"), "utf8"));
    expect(smoke).toMatchObject({ windows: ["main"], remote: { urls: ["http://127.0.0.1:*"] }, permissions: ["allow-smoke-ready"] });
    expect(smoke.permissions).toHaveLength(1);
    const updates = JSON.parse(readFileSync(resolve(tauri, "capabilities/updates.json"), "utf8"));
    expect(updates).toMatchObject({ windows: ["main"], remote: { urls: ["http://127.0.0.1:*"] } });
    expect(updates.permissions).toEqual(["allow-update-status", "allow-set-update-checks", "allow-check-for-updates", "allow-install-update"]);
  });
});
