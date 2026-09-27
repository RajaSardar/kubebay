/// <reference types="node" />
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../../../..");
const tokensCss = readFileSync(resolve(root, "web/packages/ui/src/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const stylesCss = readFileSync(resolve(root, "web/packages/ui/src/styles.css"), "utf8");

type RGBA = [number, number, number, number];

function themeVars(id: string): Record<string, string> {
  const re = /(?::root,\s*)?:root\[data-theme="([\w-]+)"\]\s*\{([^}]*)\}/g;
  for (const m of tokensCss.matchAll(re)) {
    if (m[1] !== id) continue;
    const vars: Record<string, string> = {};
    for (const d of m[2]!.matchAll(/--(kb-[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]!] = d[2]!.trim();
    return vars;
  }
  throw new Error(`theme ${id} not found`);
}

function parse(c: string): RGBA {
  c = c.trim();
  const mix = /^color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+([\d.]+)%,\s*transparent\)$/i.exec(c);
  if (mix) {
    const [r, g, b] = parse(mix[1]!);
    return [r, g, b, Number(mix[2]) / 100];
  }
  if (c.startsWith("#")) {
    const h = c.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
  }
  const n = c.match(/[\d.]+/g)!.map(Number);
  return [n[0]!, n[1]!, n[2]!, n[3] ?? 1];
}

const over = (fg: RGBA, bg: RGBA): RGBA =>
  [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])).concat(1) as RGBA;

function lum([r, g, b]: RGBA) {
  const ch = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(fg: RGBA, bg: RGBA) {
  const a = lum(over(fg, bg));
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const NATIVE = [
  { id: "dawn", text: 4.5 },
  { id: "dusk", text: 4.5 },
  { id: "dawn-hc", text: 7 },
  { id: "dusk-hc", text: 7 },
];

describe.each(NATIVE)("$id theme contrast", ({ id, text }) => {
  const v = themeVars(id);
  const c = (name: string) => parse(v[name]!);
  const ground = (name: string) => over(c(name), c("kb-bg-surface"));
  let failures: string[] = [];
  beforeEach(() => {
    failures = [];
  });
  const check = (fg: string, bg: RGBA, bgName: string, min: number) => {
    const r = contrast(c(fg), bg);
    if (r < min) failures.push(`${fg} on ${bgName}: ${r.toFixed(2)} < ${min}`);
  };
  const grounds = ["kb-bg-canvas", "kb-bg-surface", "kb-bg-raised", "kb-bg-inset"];

  it("text tokens meet the floor on every ground", () => {
    for (const g of grounds) {
      check("kb-fg-default", c(g), g, text);
      check("kb-fg-muted", c(g), g, text);
      check("kb-fg-subtle", c(g), g, 4.5);
      check("kb-accent", c(g), g, text === 7 ? 7 : 4.5);
    }
    for (const g of ["kb-bg-canvas", "kb-bg-surface"]) {
      for (const s of ["ok", "warn", "err", "pending"]) check(`kb-status-${s}`, c(g), g, 4.5);
    }
    expect(failures).toEqual([]);
  });

  it("filled and tinted pairs meet the floor", () => {
    check("kb-accent-fg", c("kb-accent"), "kb-accent", 4.5);
    check("kb-accent-fg", c("kb-accent-hover"), "kb-accent-hover", 4.5);
    check("kb-on-danger", c("kb-status-err"), "kb-status-err", 4.5);
    check("kb-accent", ground("kb-accent-subtle"), "kb-accent-subtle", 4.5);
    for (const s of ["ok", "warn", "err", "pending"]) {
      check(`kb-status-${s}-fg`, ground(`kb-status-${s}-subtle`), `kb-status-${s}-subtle`, 4.5);
    }
    expect(failures).toEqual([]);
  });

  it("the focus ring is solid and at least 3:1 against surfaces", () => {
    const ring = /(#[0-9a-f]{6}|rgba?\([^)]*\))\s*$/i.exec(v["kb-focus-ring"]!)![1]!;
    expect(parse(ring)[3]).toBe(1);
    for (const g of ["kb-bg-canvas", "kb-bg-surface"]) {
      expect(contrast(parse(ring), c(g))).toBeGreaterThanOrEqual(3);
    }
  });

  if (text === 7) {
    it("high-contrast control borders reach 3:1", () => {
      check("kb-border-strong", c("kb-bg-surface"), "kb-bg-surface", 3);
      expect(failures).toEqual([]);
    });
  }
});

it("danger buttons take their label colour from a token", () => {
  const rule = /\.kb-btn-danger\s*\{([^}]*)\}/.exec(stylesCss)![1]!;
  expect(rule).toMatch(/color:\s*var\(--kb-on-danger\)/);
});

it("rules filled with the accent or danger colour use the matching on-colour token", () => {
  const appCss = readFileSync(resolve(root, "web/apps/shell/src/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const bad: string[] = [];
  for (const m of (appCss + stylesCss).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [sel, body] = [m[1]!.trim(), m[2]!];
    const color = /(?:^|;|\s)color:\s*([^;]+);/.exec(body)?.[1]?.trim();
    if (!color) continue;
    if (/background:\s*var\(--kb-accent[,)]/.test(body) && color !== "var(--kb-accent-fg)") bad.push(`${sel}: ${color}`);
    if (/background:\s*var\(--kb-status-err[,)]/.test(body) && color !== "var(--kb-on-danger)") bad.push(`${sel}: ${color}`);
  }
  expect(bad).toEqual([]);
});
