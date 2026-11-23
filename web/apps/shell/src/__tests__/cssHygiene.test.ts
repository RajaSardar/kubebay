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

describe("band heights and layout widths", () => {
  // Every horizontal band has a fixed height from a token, so bands stack on
  // one rhythm: 40 for page headers and toolbars, 36 for tab strips, 24 for
  // the status bar. The sidebar width is one token, not a literal repeated in
  // the grid and in every calc() that steps over it.
  const decl = (css: string, sel: string, prop: string) =>
    declarations(css, new RegExp(`^${prop}$`)).filter((d) => d.sel === sel).map((d) => d.value);

  it("declares the band and layout tokens", () => {
    expect(rootToken("--kb-h-bar")).toBe("40px");
    expect(rootToken("--kb-h-tabs")).toBe("36px");
    expect(rootToken("--kb-h-status")).toBe("24px");
    expect(rootToken("--kb-line-row")).toBe("20px");
    expect(rootToken("--kb-rail-w")).toBe("56px");
    expect(rootToken("--kb-sidebar-w")).toBe("210px");
  });

  it.each([
    ["styles.css", ".page-header", "--kb-h-bar"],
    ["styles.css", ".toolbar", "--kb-h-bar"],
    ["styles.css", ".tabs", "--kb-h-tabs"],
    ["styles.css", ".drawer-pane-tabs", "--kb-h-tabs"],
    ["app.css", ".statusbar", "--kb-h-status"],
  ] as const)("%s %s is var(%s) tall", (sheet, sel, token) => {
    expect(decl(sheets[sheet], sel, "height")).toEqual([`var(${token})`]);
  });

  it("a table cell's line box is var(--kb-line-row)", () => {
    expect(decl(stylesCss, ".kb-table td", "line-height")).toEqual(["var(--kb-line-row)"]);
  });

  it("the sidebar width is never a literal", () => {
    expect(decl(appCss, ".app", "grid-template-columns")).toEqual(["var(--kb-rail-w) var(--kb-sidebar-w) minmax(0, 1fr)"]);
    // 210px is allowed only as a card's minimum width in a grid, not as the sidebar.
    const literal = [...appCss.matchAll(/[^;{}\n]*\b(56|210)px[^;{}\n]*/g)]
      .map((m) => m[0]!.trim())
      .filter((d) => /210px/.test(d) ? !/minmax\(210px, 1fr\)/.test(d) : /\b56px\s*\+/.test(d));
    expect(literal).toEqual([]);
  });
});

describe("type, radius and motion scales", () => {
  it.each(Object.entries(sheets))("%s font sizes come from --kb-text-*", (_, css) => {
    const offenders = declarations(css, /^font-size$/)
      .filter(({ value }) => !/^var\(--kb-(text-[\w-]+|[\w-]+-font-size, var\(--kb-text-[\w-]+\))\)$/.test(value) && !/^(inherit|1em|100%)$/.test(value))
      .map(({ sel, value }) => `${sel} { font-size: ${value} }`);
    expect(offenders).toEqual([]);
  });

  // Radius by role: anything that tiles the window is square, anything you
  // press or read as a chip has 2px, anything that floats over the page has
  // 6px. A circle is 50%. Never a size picked per rule.
  const ROLE_RADIUS = /^(var\(--kb-radius-(tile|control|float)\)|50%|0|inherit)$/;

  it("declares the role radii", () => {
    expect(rootToken("--kb-radius-tile")).toBe("0");
    expect(rootToken("--kb-radius-control")).toBe("2px");
    expect(rootToken("--kb-radius-float")).toBe("6px");
  });

  it.each(Object.entries(sheets))("%s radii are role tokens", (_, css) => {
    const offenders = declarations(css, /^border(-[a-z]+)*-radius$/)
      .filter(({ value }) => value.split(/\s+/).some((v) => !ROLE_RADIUS.test(v)))
      .map(({ sel, value }) => `${sel} { border-radius: ${value} }`);
    expect(offenders).toEqual([]);
  });

  it("inline radii in TSX are role tokens", () => {
    const offenders: string[] = [];
    for (const f of [...shellFiles, ...uiFiles].filter((f) => f.endsWith(".tsx"))) {
      for (const m of read(f).matchAll(/borderRadius\s*:\s*([^,}\n]+)/g)) {
        const v = m[1]!.trim().replace(/^["']|["']$/g, "");
        if (!ROLE_RADIUS.test(v)) offenders.push(`${relative(root, f)}: borderRadius: ${m[1]!.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("dots are circles and pills are 2px chips", () => {
    const radius = (sel: string) =>
      declarations(stylesCss, /^border-radius$/).filter((d) => d.sel === sel).map((d) => d.value);
    expect(radius(".kb-dot")).toEqual(["50%"]);
    expect(radius(".live-pill::before")).toEqual(["50%"]);
    for (const pill of [".status-ok", ".status-err", ".status-warn", ".status-pending", ".ns-pill", ".live-pill", ".kb-badge"]) {
      expect({ pill, r: radius(pill) }).toEqual({ pill, r: ["var(--kb-radius-control)"] });
    }
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

describe("no resting shadows", () => {
  // Things at rest sit flat on their ground; only things that float over the
  // page (menus, dialogs, the drawer, the palette) cast a shadow.
  it("no stylesheet uses a resting shadow, and no theme declares one", () => {
    expect([...Object.values(sheets), tokensCss].filter((css) => /--kb-shadow-rest\b/.test(css))).toEqual([]);
  });

  it("cards and buttons at rest have no box-shadow (only the selection bar)", () => {
    const offenders = declarations(stylesCss, /^box-shadow$/)
      .filter(({ sel }) => /^\.kb-(card|btn)[\w-]*(\.[\w-]+)*$/.test(sel))
      .filter(({ value }) => value !== "none" && value !== "inset 3px 0 0 var(--kb-accent)")
      .map(({ sel, value }) => `${sel} { box-shadow: ${value} }`);
    expect(offenders).toEqual([]);
  });
});

describe("the frame is opaque chrome", () => {
  // The sidebar, rail and status bar are one opaque shade, --kb-bg-chrome. No
  // translucency, no blur and no background glow; the brand gradient survives
  // as a 1px rule on top of the status bar.
  const decl = (css: string, sel: string, prop: string) =>
    declarations(css, new RegExp(`^${prop}$`)).filter((d) => d.sel === sel).map((d) => d.value);

  it.each([".sidebar", ".cluster-strip", ".statusbar", ".catalog-statusbar"])("%s is opaque chrome", (sel) => {
    expect(decl(appCss, sel, "background")).toEqual(["var(--kb-bg-chrome)"]);
  });

  it("the page header is opaque", () => {
    expect(decl(stylesCss, ".page-header", "background")).toEqual(["var(--kb-bg-surface)"]);
  });

  it("nothing in the frame is blurred or translucent", () => {
    const blur = [...declarations(appCss, /^(-webkit-)?backdrop-filter$/), ...declarations(stylesCss, /^(-webkit-)?backdrop-filter$/)]
      .filter(({ sel }) => /^\.(sidebar|cluster-strip|statusbar|catalog-statusbar|page-header)$/.test(sel))
      .map(({ sel }) => sel);
    expect(blur).toEqual([]);
    for (const t of ["--kb-material", "--kb-material-blur", "--kb-bg-sidebar", "--kb-glow-a", "--kb-glow-b"]) {
      expect({ t, used: [tokensCss, appCss, stylesCss].some((css) => new RegExp(`${t}\\b`).test(css)) }).toEqual({ t, used: false });
    }
  });

  it("there is no background glow", () => {
    expect(appCss).not.toMatch(/body::before/);
  });

  it("the status bar's top rule is the 1px brand gradient", () => {
    const bg = decl(appCss, ".statusbar::before", "background");
    expect(bg).toEqual(["linear-gradient(90deg, var(--kb-brand-cyan), var(--kb-brand-green))"]);
    expect(decl(appCss, ".statusbar::before", "height")).toEqual(["1px"]);
  });

  it("the sidebar has no side padding, so nav items run edge to edge", () => {
    expect(decl(appCss, ".sidebar", "padding")).toEqual(["0 0 8px"]);
    // The nav items' own side padding is the sidebar gutter, and indentation is a variable, not a margin.
    expect(decl(stylesCss, ".nav-item", "margin")).toEqual([]);
    expect(decl(stylesCss, ".nav-item.active", "font-weight")).toEqual(["500"]);
  });
});

describe("the drawer is flush with a chrome head", () => {
  // The drawer runs from the top of the window down to the status bar and the
  // right edge. A hairline and its edge shadow mark where it starts, so a click
  // to its left still reads as "outside". Its head and tab strip are chrome.
  const decl = (sel: string, prop: string) =>
    declarations(stylesCss, new RegExp(`^${prop}$`)).filter((d) => d.sel === sel).map((d) => d.value);

  it("stops at the status bar and keeps a hairline on its leading edge", () => {
    expect(decl(".drawer", "top")).toEqual(["0"]);
    expect(decl(".drawer", "right")).toEqual(["0"]);
    expect(decl(".drawer", "bottom")).toEqual(["var(--kb-h-status)"]);
    expect(decl(".drawer", "border-left")).toEqual(["1px solid var(--kb-separator)"]);
    expect(decl(".drawer", "box-shadow")).toEqual(["var(--kb-shadow-lift)"]);
  });

  it("its head and tab strip are chrome bands with a separator under them", () => {
    expect(decl(".drawer-head", "background")).toEqual(["var(--kb-bg-chrome)"]);
    expect(decl(".drawer-head", "min-height")).toEqual(["var(--kb-h-bar)"]);
    expect(decl(".drawer-head", "border-bottom")).toEqual(["1px solid var(--kb-separator)"]);
    expect(decl(".drawer-pane-tabs", "background")).toEqual(["var(--kb-bg-chrome)"]);
    expect(decl(".drawer-pane-tabs", "border-bottom")).toEqual(["1px solid var(--kb-separator)"]);
  });

  it("section titles in a drawer are chrome bands", () => {
    const title = declarations(appCss, /^background$/).filter((d) => d.sel === ".pod-section-title").map((d) => d.value);
    expect(title).toEqual(["var(--kb-bg-chrome)"]);
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
    "actionsbar", "catalog-status-cell", "events-", "fleet-card", "kb-fg-muted",
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
    // The new-resource button and the icon picker's placement (a Modal className).
    expect(fixed).toEqual([".icon-picker", ".resource-fab"].sort());
  });

  // Raw <button>s still in the shell, per file. The count may only go down:
  // new controls use Button, IconButton, SegmentedControl, Tabs or a new
  // @kubebay/ui component.
  const RAW_BUTTONS: Record<string, number> = {
    "App.tsx": 3,
    "components/ClusterIconPicker.tsx": 2,
    "components/NamespaceFilter.tsx": 4,
    "components/Palette.tsx": 1,
    "components/PodGraphs.tsx": 2,
    "pages/Crds.tsx": 1,
    "pages/ResourceDetail.tsx": 1,
    "pages/ResourceTable.tsx": 1,
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
