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
