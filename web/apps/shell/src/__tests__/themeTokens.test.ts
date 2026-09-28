/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const tokensCss = read("web/packages/ui/src/tokens.css");
const stylesCss = read("web/packages/ui/src/styles.css");
const appCss = read("web/apps/shell/src/app.css");
// Custom properties the app sets at runtime instead of in CSS.
const runtimeSet = read("web/apps/shell/src/lib/display.ts");

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function declared(css: string): Set<string> {
  return new Set([...stripComments(css).matchAll(/(--kb-[\w-]+)\s*:/g)].map((m) => m[1]!));
}

function referenced(css: string): Set<string> {
  return new Set([...stripComments(css).matchAll(/var\(\s*(--kb-[\w-]+)/g)].map((m) => m[1]!));
}

/** Split tokens.css into { themeId: body } using the `:root[data-theme="x"]` blocks. */
function themeBlocks(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /((?::root,\s*)?:root\[data-theme="([\w-]+)"\])\s*\{([^}]*)\}/g;
  for (const m of stripComments(css).matchAll(re)) out[m[2]!] = m[3]!;
  return out;
}

describe("theme tokens", () => {
  const known = new Set([
    ...declared(tokensCss),
    ...declared(stylesCss),
    ...declared(appCss),
    ...[...runtimeSet.matchAll(/setProperty\("(--kb-[\w-]+)"/g)].map((m) => m[1]!),
  ]);

  it("every --kb-* variable used by the shell and ui styles is declared", () => {
    const used = new Set([...referenced(appCss), ...referenced(stylesCss)]);
    const missing = [...used].filter((v) => !known.has(v)).sort();
    expect(missing).toEqual([]);
  });

  it("all twelve themes define the same colour tokens as Dusk", () => {
    const blocks = themeBlocks(tokensCss);
    expect(Object.keys(blocks).sort()).toEqual(
      [
        "catppuccin", "dawn", "dawn-hc", "dracula", "dusk", "dusk-hc", "github-dark",
        "github-light", "nord", "one-dark", "vscode-dark", "vscode-light",
      ],
    );
    const names = (body: string) => [...declared(`x{${body}}`)].sort();
    const reference = names(blocks.dusk!);
    for (const [id, body] of Object.entries(blocks)) {
      expect({ id, tokens: names(body) }).toEqual({ id, tokens: reference });
    }
  });

  it("shell chrome uses theme tokens, not hard-coded colours", () => {
    const rule = (sel: string) => {
      const m = new RegExp(`${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(appCss);
      if (!m) throw new Error(`rule ${sel} not found`);
      return m[1]!;
    };
    for (const sel of [".catalog-nav-item.active", ".catalog-engine-dot"]) {
      expect({ sel, literal: /#[0-9a-f]{3,8}\b|rgba?\(/i.test(rule(sel)) }).toEqual({ sel, literal: false });
    }
  });
});

describe("@kubebay/ui owns the styles of its components", () => {
  const selectors = [
    ".status-ok", ".status-terminating", ".tabs", ".tab.active", ".nav-item", ".nav-item.sub", ".nav-section",
    ".toolbar-input", ".toolbar-select", "kbd", ".page-header", ".page-header-actions", ".ctx-menu", ".ctx-item",
    ".kb-table", ".kb-table th", ".palette-box", ".palette-item.active", ".ns-pill", ".cell-link", ".live-pill",
    ".empty-state", ".inline-banner", ".inline-banner.warn", ".inline-banner-actions", ".row-clickable", ".drawer-pane-tabs .tab", ".inline-banner.flush",
  ];
  const defines = (css: string, sel: string) =>
    stripComments(css)
      .split("}")
      .some((chunk) => {
        const head = chunk.split("{")[0] ?? "";
        return chunk.includes("{") && head.split(",").some((s) => s.trim() === sel);
      });

  it.each(selectors)("%s is defined in styles.css, not app.css", (sel) => {
    expect({ sel, ui: defines(stylesCss, sel), app: defines(appCss, sel) }).toEqual({ sel, ui: true, app: false });
  });
});

describe("Settings theme swatches", () => {
  const settings = read("web/apps/shell/src/pages/Settings.tsx");
  const blocks = themeBlocks(tokensCss);
  const value = (id: string, name: string) =>
    new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(blocks[id]!)?.[1]?.trim().toLowerCase();
  const swatches = [...settings.matchAll(/id: "([\w-]+)",.*?swatch: \["(#\w+)", "(#\w+)", "(#\w+)"\]/g)]
    .filter((m) => m[1] !== "system");

  it.each(swatches.map((m) => [m[1]!, m[2]!, m[3]!, m[4]!]))(
    "%s swatch shows its canvas, surface and accent",
    (id, canvas, surface, accent) => {
      expect(canvas.toLowerCase()).toBe(value(id, "kb-bg-canvas"));
      expect(["kb-bg-surface", "kb-bg-raised", "kb-bg-sidebar"].map((t) => value(id, t))).toContain(surface.toLowerCase());
      expect(accent.toLowerCase()).toBe(value(id, "kb-accent"));
    },
  );
});

describe("app.css never restyles @kubebay/ui classes", () => {
  // Classes whose look the package owns. A later app.css rule targeting one of them
  // silently overrides the design system (this is how ghost/danger Buttons drifted).
  const owned = new Set(
    [...stripComments(stylesCss).matchAll(/([^{}]+)\{/g)]
      .flatMap((m) => [...m[1]!.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((c) => c[1]!))
      .filter((c) => !["active", "sub", "open", "ok", "warn", "danger", "disabled", "selected", "hovered", "chev", "muted", "small", "page"].includes(c)),
  );

  it("has no app.css rule whose selector names a package-owned class", () => {
    const offenders = [...stripComments(appCss).matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1]!.trim())
      .filter((sel) => !sel.startsWith("@") && !/^(from|to|[\d.%,\s]+)$/.test(sel))
      .filter((sel) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].some((c) => owned.has(c[1]!)));
    expect(offenders).toEqual([]);
  });
});

describe("app.css colours come from tokens", () => {
  it("has no hex or rgb() colour literals", () => {
    const offenders = stripComments(appCss)
      .split("\n")
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(l))
      .map(([n, l]) => `${n}: ${l.trim()}`);
    expect(offenders).toEqual([]);
  });
});

describe("forced colours (Windows High Contrast)", () => {
  // Forced-colours mode drops box-shadow and author backgrounds, so anything drawn
  // with them (focus rings, the selected-row bar, status dots) must be restated.
  const block = /@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?)\n\}/.exec(stripComments(stylesCss))?.[1] ?? "";

  it("restores focus rings with an outline", () => {
    expect(block).toMatch(/:focus-visible[^{]*\{[^}]*outline:\s*2px solid Highlight/);
  });

  it("marks selected table rows without the box-shadow bar", () => {
    expect(block).toMatch(/\.kb-table tbody tr\.selected[^{]*\{[^}]*outline:[^;]*Highlight/);
  });

  it("keeps status dots and skeletons in their own colours", () => {
    expect(block).toMatch(/\.kb-dot[^{]*\{[^}]*forced-color-adjust:\s*none/);
  });
});
