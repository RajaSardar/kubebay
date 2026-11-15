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
  // Editor themes keep their palette's hues but must still read: same AA floor as Dawn and Dusk.
  ...["vscode-dark", "vscode-light", "one-dark", "dracula", "nord", "github-dark", "github-light", "catppuccin"].map(
    (id) => ({ id, text: 4.5 }),
  ),
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

  it("tinted fills keep their text readable on every ground they sit on", () => {
    // Badges sit on canvas, segmented controls on inset, the palette on raised.
    for (const g of grounds) {
      const tint = (t: string) => over(c(t), c(g));
      check("kb-accent", tint("kb-accent-subtle"), `kb-accent-subtle on ${g}`, 4.5);
      for (const s of ["ok", "warn", "err", "pending"]) {
        check(`kb-status-${s}-fg`, tint(`kb-status-${s}-subtle`), `kb-status-${s}-subtle on ${g}`, 4.5);
      }
    }
    expect(failures).toEqual([]);
  });

  it("a selected table row keeps its text, pills and namespace readable", () => {
    const row = over(c("kb-accent-subtle"), c("kb-bg-surface"));
    check("kb-fg-default", row, "selected row", text);
    check("kb-fg-muted", row, "selected row", text);
    check("kb-accent", row, "selected row", 4.5);
    for (const s of ["ok", "warn", "err", "pending"]) {
      check(`kb-status-${s}-fg`, over(c(`kb-status-${s}-subtle`), row), `kb-status-${s}-subtle on a selected row`, 4.5);
    }
    expect(failures).toEqual([]);
  });

  it("a row that just changed is visibly tinted and keeps its text readable", () => {
    const row = over(c("kb-row-changed"), c("kb-bg-surface"));
    check("kb-fg-default", row, "changed row", text);
    check("kb-fg-muted", row, "changed row", text);
    const lift = contrast(row, c("kb-bg-surface"));
    if (lift < 1.15) failures.push(`changed row against the surface: ${lift.toFixed(2)} < 1.15`);
    expect(failures).toEqual([]);
  });

  it("skeleton blocks stand out from every ground they load on", () => {
    // .kb-skeleton fills with --kb-fg-default at N% (read from styles.css).
    const pct = Number(/\.kb-skeleton\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--kb-fg-default\)\s+([\d.]+)%/.exec(stylesCss)?.[1] ?? 0) / 100;
    const fg = c("kb-fg-default");
    for (const g of grounds) {
      const fill = over([fg[0], fg[1], fg[2], fg[3] * pct], c(g));
      const r = contrast(fill, c(g));
      if (r < 1.25) failures.push(`skeleton on ${g}: ${r.toFixed(2)} < 1.25`);
    }
    expect(failures).toEqual([]);
  });

  it("ok, warn and err read as three different statuses", () => {
    const hs = ([r, g, b]: RGBA) => {
      const [R, G, B] = [r / 255, g / 255, b / 255];
      const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min, l = (max + min) / 2;
      const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      const h = d === 0 ? 0 : max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
      return { h: (h * 60 + 360) % 360, s: sat };
    };
    const tones = ["ok", "warn", "err"].map((t) => ({ t, ...hs(c(`kb-status-${t}`)) }));
    for (const x of tones) if (x.s < 0.5) failures.push(`kb-status-${x.t} is too grey to read as a status (saturation ${x.s.toFixed(2)})`);
    for (let i = 0; i < tones.length; i++)
      for (let j = i + 1; j < tones.length; j++) {
        const d = Math.min(Math.abs(tones[i]!.h - tones[j]!.h), 360 - Math.abs(tones[i]!.h - tones[j]!.h));
        if (d < 25) failures.push(`kb-status-${tones[i]!.t} and ${tones[j]!.t} are only ${d.toFixed(0)}° apart`);
      }
    expect(failures).toEqual([]);
  });

  it("muted text is never mistaken for the accent (links, active nav)", () => {
    const hsl = ([r, g, b]: RGBA) => {
      const [R, G, B] = [r / 255, g / 255, b / 255];
      const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min, l = (max + min) / 2;
      const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      const h = d === 0 ? 0 : max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
      return { h: (h * 60 + 360) % 360, s: sat };
    };
    const muted = hsl(c("kb-fg-muted")), accent = hsl(c("kb-accent"));
    const apart = Math.min(Math.abs(muted.h - accent.h), 360 - Math.abs(muted.h - accent.h));
    if (muted.s >= 0.35 && apart < 40) failures.push(`kb-fg-muted is a saturated ${muted.h.toFixed(0)}°, ${apart.toFixed(0)}° from the accent`);
    expect(failures).toEqual([]);
  });

  it("the focus ring is solid and at least 3:1 against surfaces", () => {
    const ring = /(#[0-9a-f]{6}|rgba?\([^)]*\))\s*$/i.exec(v["kb-focus-ring"]!)![1]!;
    expect(parse(ring)[3]).toBe(1);
    for (const g of ["kb-bg-canvas", "kb-bg-surface"]) {
      expect(contrast(parse(ring), c(g))).toBeGreaterThanOrEqual(3);
    }
  });

  it("pending reads as its own status, not as a warning or an error", () => {
    const hue = ([r, g, b]: RGBA) => {
      const [R, G, B] = [r / 255, g / 255, b / 255];
      const max = Math.max(R, G, B), d = max - Math.min(R, G, B);
      if (d === 0) return 0;
      const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    for (const other of ["warn", "err"]) {
      const d = apart(hue(c("kb-status-pending")), hue(c(`kb-status-${other}`)));
      if (d < 60) failures.push(`pending is ${d.toFixed(0)}° from ${other}`);
    }
    expect(failures).toEqual([]);
  });

  it("chart series reach 3:1 on every ground and stay apart in hue", () => {
    const series = [1, 2, 3, 4, 5].map((n) => `kb-chart-${n}`);
    for (const sName of series) for (const g of grounds) check(sName, c(g), g, 3);
    const hue = ([r, g, b]: RGBA) => {
      const [R, G, B] = [r / 255, g / 255, b / 255];
      const max = Math.max(R, G, B), d = max - Math.min(R, G, B);
      if (d === 0) return 0;
      const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (let i = 0; i < series.length; i++)
      for (let j = i + 1; j < series.length; j++) {
        const a = hue(c(series[i]!)), b = hue(c(series[j]!));
        const d = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
        if (d < 20) failures.push(`${series[i]} and ${series[j]} are ${d.toFixed(0)}° apart`);
      }
    expect(failures).toEqual([]);
  });

  it("status colours read on raised and inset grounds too", () => {
    for (const g of ["kb-bg-raised", "kb-bg-inset"]) {
      for (const s of ["ok", "warn", "err", "pending"]) check(`kb-status-${s}`, c(g), g, 4.5);
    }
    expect(failures).toEqual([]);
  });

  it("form control borders reach 3:1 on every ground (WCAG 1.4.11)", () => {
    for (const g of grounds) {
      const r = contrast(over(c("kb-border-control"), c(g)), c(g));
      if (r < 3) failures.push(`kb-border-control on ${g}: ${r.toFixed(2)} < 3`);
    }
    expect(failures).toEqual([]);
  });

  if (text === 7) {
    it("high-contrast control borders reach 3:1", () => {
      check("kb-border-strong", c("kb-bg-surface"), "kb-bg-surface", 3);
      expect(failures).toEqual([]);
    });
  }
});

it("inputs and selects draw their border with the control token", () => {
  const rule = /\.toolbar-select,\s*\.toolbar-input\s*\{([^}]*)\}/.exec(stylesCss)![1]!;
  expect(rule).toMatch(/border:\s*1px solid var\(--kb-border-control\)/);
  const appCss = readFileSync(resolve(root, "web/apps/shell/src/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const weak = [...appCss.matchAll(/([^{}]*(?:input|select|textarea)[^{}]*)\{([^}]*)\}/g)]
    .filter((m) => !/:(hover|focus)/.test(m[1]!) && /(?:^|;|\s)border:\s*1px solid var\(--kb-border-(subtle|strong)\)/.test(m[2]!))
    .map((m) => m[1]!.trim());
  expect(weak).toEqual([]);
});

it("a namespace pill in a selected row does not stack a second tint", () => {
  const rule = /\.kb-table tbody tr\.selected \.ns-pill\s*\{([^}]*)\}/.exec(stylesCss)?.[1] ?? "";
  expect(rule).toMatch(/background:\s*var\(--kb-bg-surface\)/);
});

it("the palette's loading label stays readable (no fading text)", () => {
  const rule = /\.palette-section-loading\s*\{([^}]*)\}/.exec(stylesCss)![1]!;
  expect(rule).toMatch(/color:\s*var\(--kb-fg-muted\)/);
  expect(rule).not.toMatch(/animation:/);
});

it("skeletons have a box even inside a table cell", () => {
  // An inline <span> ignores width and height, so SkeletonRows drew nothing.
  const rule = /\.kb-skeleton\s*\{([^}]*)\}/.exec(stylesCss)![1]!;
  expect(rule).toMatch(/display:\s*inline-block/);
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
    // The on-colour tokens are for solid fills only: on a tint (or no fill) they vanish.
    if (color === "var(--kb-accent-fg)" && !/background:\s*var\(--kb-accent(-hover)?\)/.test(body)) bad.push(`${sel}: accent-fg off the accent fill`);
  }
  expect(bad).toEqual([]);
});
