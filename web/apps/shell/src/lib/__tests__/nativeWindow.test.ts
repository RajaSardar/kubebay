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
  it("declares set_window_theme and lets only the engine-served page call only it", () => {
    expect(readFileSync(resolve(tauri, "build.rs"), "utf8")).toMatch(/commands\(&\["set_window_theme"\]\)/);
    expect(readFileSync(resolve(tauri, "src/main.rs"), "utf8")).toMatch(/generate_handler!\[set_window_theme\]/);
    const cap = JSON.parse(readFileSync(resolve(tauri, "capabilities/window-theme.json"), "utf8"));
    expect(cap).toMatchObject({ windows: ["main"], remote: { urls: ["http://127.0.0.1:*"] }, permissions: ["allow-set-window-theme"] });
  });
});
