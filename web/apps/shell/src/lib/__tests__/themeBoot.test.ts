/// <reference types="node" />
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../../../../..");
const indexHtml = readFileSync(resolve(root, "web/apps/shell/index.html"), "utf8");
const tokensCss = readFileSync(resolve(root, "web/packages/ui/src/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

type Env = { dark?: boolean; moreContrast?: boolean };

function stubMatchMedia({ dark = false, moreContrast = false }: Env) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-color-scheme: dark") ? dark : q.includes("prefers-contrast: more") ? moreContrast : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

function themeColor(id: string): string {
  const re = /(?::root,\s*)?:root\[data-theme="([\w-]+)"\]\s*\{([^}]*)\}/g;
  for (const m of tokensCss.matchAll(re)) {
    if (m[1] === id) return /--kb-theme-color\s*:\s*([^;]+);/.exec(m[2]!)![1]!.trim().toLowerCase();
  }
  throw new Error(`theme ${id} not found`);
}

const bootScript = /<script id="kb-theme-boot">([\s\S]*?)<\/script>/.exec(indexHtml)?.[1];

function boot(stored: Record<string, string>, env: Env) {
  localStorage.clear();
  for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
  stubMatchMedia(env);
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
  new Function(bootScript!)();
  return {
    theme: document.documentElement.dataset.theme,
    color: document.querySelector('meta[name="theme-color"]')!.getAttribute("content"),
  };
}

const CASES: { stored: Record<string, string>; env: Env; want: string }[] = [
  { stored: {}, env: {}, want: "dawn" },
  { stored: { "kb.theme.version": "2", "kb.theme": "nord" }, env: {}, want: "nord" },
  { stored: { "kb.theme": "nord" }, env: {}, want: "dawn" }, // pre-v2 choice is reset to the default
  { stored: { "kb.theme.version": "2", "kb.theme": "system" }, env: { dark: true }, want: "dusk" },
  { stored: { "kb.theme.version": "2", "kb.theme": "system" }, env: { dark: false }, want: "dawn" },
  { stored: { "kb.theme.version": "2", "kb.theme": "system" }, env: { dark: true, moreContrast: true }, want: "dusk-hc" },
  { stored: { "kb.theme.version": "2", "kb.theme": "system" }, env: { moreContrast: true }, want: "dawn-hc" },
  { stored: { "kb.theme.version": "2", "kb.theme": "bogus" }, env: {}, want: "dawn" },
];

describe("index.html theme boot", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("has an inline boot script that runs before the stylesheet and the app bundle", () => {
    expect(bootScript).toBeDefined();
    const at = (s: string) => indexHtml.indexOf(s);
    expect(at('id="kb-theme-boot"')).toBeLessThan(at('rel="stylesheet"'));
    expect(at('id="kb-theme-boot"')).toBeLessThan(at('type="module"'));
  });

  it("starts from the default theme, not Dusk, when scripts are off", () => {
    expect(indexHtml).toMatch(/<html lang="en" data-theme="dawn">/);
    expect(indexHtml).toContain(`<meta name="theme-color" content="${themeColor("dawn")}" />`);
  });

  it.each(CASES)("stored $stored with $env boots $want and its theme colour", ({ stored, env, want }) => {
    expect(boot(stored, env)).toEqual({ theme: want, color: themeColor(want) });
  });
});

describe("resolveTheme matches the boot script", () => {
  it.each(CASES.filter((c) => c.stored["kb.theme.version"] && c.stored["kb.theme"] !== "bogus"))(
    "$stored with $env resolves to $want",
    async ({ stored, env, want }) => {
      stubMatchMedia(env);
      const { resolveTheme } = await import("../theme");
      expect(resolveTheme(stored["kb.theme"] as never)).toBe(want);
    },
  );
});
