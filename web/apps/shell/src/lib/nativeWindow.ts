import type { ThemeName } from "./theme";

/** Themes drawn on a light ground; every other theme is dark. */
export const LIGHT_THEMES: ReadonlySet<ThemeName> = new Set<ThemeName>(["dawn", "dawn-hc", "vscode-light", "github-light"]);

export type NativeAppearance = "dark" | "light" | "system";

/**
 * The window appearance (title bar, and the webview's prefers-color-scheme on
 * macOS) for a theme choice. "System" must leave it to the OS: forcing it would
 * also force the media query that "system" itself reads.
 */
export function nativeAppearance(t: ThemeName): NativeAppearance {
  if (t === "system") return "system";
  return LIGHT_THEMES.has(t) ? "light" : "dark";
}

type TauriInternals = { invoke?: (cmd: string, args: unknown) => Promise<unknown> };

/**
 * In the desktop app, paints the native window behind the page in the theme's
 * colour and matches its title bar, so a reload or the next launch does not
 * flash the OS default. A no-op in a browser tab.
 */
export function syncNativeWindow(background: string, appearance: NativeAppearance) {
  const ipc = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  const color = background.trim();
  if (!ipc?.invoke || !/^#[0-9a-f]{6}$/i.test(color)) return;
  ipc.invoke("set_window_theme", { background: color, appearance }).catch(() => {});
}
