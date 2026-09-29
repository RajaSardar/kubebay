/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

// Scale hygiene: every size, layer and duration the shell styles use comes from a
// token, nothing is left behind when a page is rewritten, and new overlays and
// buttons go through @kubebay/ui.
const root = resolve(__dirname, "../../../../..");
const src = resolve(__dirname, "..");
const uiSrc = resolve(root, "web/packages/ui/src");
const read = (p: string) => readFileSync(p, "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const tokensCss = stripComments(read(join(uiSrc, "tokens.css")));
const stylesCss = stripComments(read(join(uiSrc, "styles.css")));
const appCss = stripComments(read(join(src, "app.css")));
const sheets = { "app.css": appCss, "styles.css": stylesCss };

function sourceFiles(dir: string, ext = /\.tsx?$/): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(p, ext);
    return ext.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const shellFiles = sourceFiles(src);
const uiFiles = sourceFiles(uiSrc);
const shellSource = shellFiles.map(read).join("\n");
const allSource = shellSource + "\n" + uiFiles.map(read).join("\n");

/** Every `prop: value` declaration in a stylesheet, with its selector. */
function declarations(css: string, prop: RegExp) {
  const out: { sel: string; value: string }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const d of m[2]!.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)) {
      if (prop.test(d[1]!)) out.push({ sel: m[1]!.trim().split("\n").pop()!.trim(), value: d[2]!.trim() });
    }
  }
  return out;
}

const rootBlock = /:root\s*\{([^}]*)\}/.exec(tokensCss)![1]!;
const rootToken = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(rootBlock)?.[1]?.trim();

describe("tokens referenced from TSX exist", () => {
  it("every var(--kb-*) in shell and ui source is declared in a stylesheet", () => {
    const declared = new Set(
      [tokensCss, stylesCss, appCss].flatMap((c) => [...c.matchAll(/(--kb-[\w-]+)\s*:/g)].map((m) => m[1]!)),
    );
    for (const m of allSource.matchAll(/setProperty\(\s*["'](--kb-[\w-]+)/g)) declared.add(m[1]!);
    const used = new Set([...allSource.matchAll(/var\(\s*(--kb-[\w-]+)/g)].map((m) => m[1]!));
    // Families built at runtime (`--kb-chart-${i}`) end in a dash.
    const missing = [...used].filter((v) => !v.endsWith("-") && !declared.has(v)).sort();
    expect(missing).toEqual([]);
  });
});

describe("z-index scale", () => {
  const LAYERS = ["sticky", "drawer", "dropdown", "overlay", "palette", "modal", "popover"];

  it("declares the layers in stacking order", () => {
    const values = LAYERS.map((l) => Number(rootToken(`--kb-z-${l}`)));
    expect(values.every((v) => Number.isInteger(v))).toBe(true);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(new Set(values).size).toBe(values.length);
  });

  it.each(Object.entries(sheets))("%s layers with tokens (only in-component stacking 0–3 is literal)", (_, css) => {
    const offenders = declarations(css, /^z-index$/)
      .filter(({ value }) => !/^-?[0-3]$/.test(value) && !/^(calc\()?var\(--kb-z-[\w-]+\)/.test(value))
      .map(({ sel, value }) => `${sel} { z-index: ${value} }`);
    expect(offenders).toEqual([]);
  });

  it("shell TSX sets no zIndex inline", () => {
    expect(shellSource.match(/zIndex\s*:/g) ?? []).toEqual([]);
  });
});

describe("type, radius and motion scales", () => {
  it.each(Object.entries(sheets))("%s font sizes come from --kb-text-*", (_, css) => {
    const offenders = declarations(css, /^font-size$/)
      .filter(({ value }) => !/^var\(--kb-(text-[\w-]+|[\w-]+-font-size, var\(--kb-text-[\w-]+\))\)$/.test(value) && !/^(inherit|1em|100%)$/.test(value))
      .map(({ sel, value }) => `${sel} { font-size: ${value} }`);
    expect(offenders).toEqual([]);
  });

  it.each(Object.entries(sheets))("%s radii come from --kb-radius-*", (_, css) => {
    const offenders = declarations(css, /^border(-[a-z]+)*-radius$/)
      .filter(({ value }) => value.split(/\s+/).some((v) => !/^(var\(--kb-radius[\w-]*\)|50%|0|inherit)$/.test(v)))
      .map(({ sel, value }) => `${sel} { border-radius: ${value} }`);
    expect(offenders).toEqual([]);
  });

  it.each(Object.entries(sheets))("%s UI transitions use --kb-dur-* (only long loops are literal)", (_, css) => {
    const offenders = declarations(css, /^(transition|animation)(-duration|-delay)?$/)
      .filter(({ value }) =>
        [...value.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g)].some(([, n, u]) => {
          const ms = Number(n) * (u === "s" ? 1000 : 1);
          return ms > 0.01 && ms <= 400;
        }),
      )
      .map(({ sel, value }) => `${sel} { ${value} }`);
    expect(offenders).toEqual([]);
  });

  it("inline font sizes in TSX use --kb-text-*", () => {
    const offenders: string[] = [];
    for (const f of shellFiles.filter((f) => f.endsWith(".tsx"))) {
      const text = read(f);
      for (const m of text.matchAll(/fontSize\s*:\s*([^,}\n]+)/g)) {
        const before = text.slice(0, m.index);
        const style = before.lastIndexOf("style={{");
        // Only inline styles: Monaco and xterm take a numeric fontSize option.
        if (style < 0 || before.lastIndexOf("options={{") > style || before.indexOf("}}", style) >= 0) continue;
        if (/^["']var\(--kb-text-[\w-]+\)["']$|^["']inherit["']$/.test(m[1]!.trim())) continue;
        offenders.push(`${relative(src, f)}: fontSize: ${m[1]!.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("no dead styles or pages", () => {
  // Classes put together at runtime, e.g. `events-${type.toLowerCase()}`.
  const DYNAMIC = [/^events-(normal|warning)$/];

  it("every app.css class is used by some shell or ui source", () => {
    const classes = new Set([...appCss.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!));
    const unused = [...classes]
      .filter((c) => !DYNAMIC.some((d) => d.test(c)))
      .filter((c) => !new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(allSource))
      .sort();
    expect(unused).toEqual([]);
  });

  // Classes the source uses only as test hooks or prefixes, with no styles of their own.
  const HOOKS = new Set([
    "actionsbar", "catalog-status-cell", "events-", "fleet-card", "ghost", "icon-picker-btn", "kb-fg-muted",
    "np-ns-badge", "palette-pod-status--", "pod-summary", "rbac-finding", "rbac-findings-list", "status-", "statusbar-center",
  ]);

  it("every class the shell and ui source use is styled somewhere (so deleting CSS cannot orphan markup)", () => {
    const styled = new Set([...(appCss + stylesCss).matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!));
    const used = new Set(
      [...allSource.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].flatMap((m) =>
        (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, " ").split(/\s+/).filter(Boolean),
      ),
    );
    expect([...used].filter((c) => !styled.has(c) && !HOOKS.has(c)).sort()).toEqual([]);
  });

  it("every app.css @keyframes is played by some animation", () => {
    const names = [...appCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!);
    const played = appCss.replace(/@keyframes\s+[\w-]+/g, "") + stylesCss + allSource;
    expect(names.filter((n) => !new RegExp(`(?<![\\w-])${n}(?![\\w-])`).test(played))).toEqual([]);
  });

  it("every page module is imported somewhere", () => {
    const pages = readdirSync(join(src, "pages")).filter((f) => f.endsWith(".tsx"));
    const orphans = pages
      .map((f) => basename(f, ".tsx"))
      .filter((name) => !new RegExp(`["'](\\./|\\.\\./)(pages/)?${name}["']`).test(shellSource));
    expect(orphans).toEqual([]);
  });
});

describe("@kubebay/ui owns reduced motion", () => {
  const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/;
  it("styles.css carries the reduced-motion rule", () => expect(stylesCss).toMatch(block));
  it("app.css does not repeat it", () => expect(appCss).not.toMatch(block));
});

describe("overlays and buttons go through @kubebay/ui", () => {
  it("shell TSX builds no dialogs or portals by hand (use Drawer / Modal)", () => {
    const offenders = shellFiles
      .filter((f) => /role=["']dialog["']|aria-modal|createPortal\(/.test(read(f)))
      .map((f) => relative(src, f));
    expect(offenders).toEqual([]);
  });

  it("app.css pins nothing new to the viewport", () => {
    const fixed = declarations(appCss, /^position$/)
      .filter(({ value }) => value === "fixed")
      .map(({ sel }) => sel)
      .sort();
    // The page backdrop, the new-resource button and the icon picker's
    // placement (a Modal className).
    expect(fixed).toEqual(["body::before", ".icon-picker", ".resource-fab"].sort());
  });

  // Raw <button>s still in the shell, per file. The count may only go down:
  // new controls use Button, IconButton, SegmentedControl, Tabs or a new
  // @kubebay/ui component.
  const RAW_BUTTONS: Record<string, number> = {
    "App.tsx": 7,
    "components/ClusterDetailDrawer.tsx": 3,
    "components/ClusterIconPicker.tsx": 2,
    "components/ErrorBoundary.tsx": 2,
    "components/NamespaceFilter.tsx": 4,
    "components/Palette.tsx": 2,
    "components/PodGraphs.tsx": 2,
    "pages/ClusterPicker.tsx": 1,
    "pages/Crds.tsx": 1,
    "pages/ResourceDetail.tsx": 1,
    "pages/ResourceTable.tsx": 1,
    "pages/Settings.tsx": 2,
  };

  it("adds no hand-written <button>s", () => {
    const counts = Object.fromEntries(
      shellFiles
        .map((f) => [relative(src, f), (read(f).match(/<button[\s>]/g) ?? []).length] as const)
        .filter(([, n]) => n > 0),
    );
    const over = Object.entries(counts)
      .filter(([f, n]) => n > (RAW_BUTTONS[f] ?? 0))
      .map(([f, n]) => `${f}: ${n} raw <button> (allowed ${RAW_BUTTONS[f] ?? 0})`);
    expect(over).toEqual([]);
  });
});
