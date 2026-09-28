/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// The shell renders these patterns through @kubebay/ui components, never by hand,
// so the package stays the single source of truth for their markup.
const src = resolve(__dirname, "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : tsxFiles(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

const PATTERNS: [string, RegExp][] = [
  ["PageHeader", /className="page-header"/],
  ["live pill (PageHeader live)", /className="live-pill"/],
  ["TextField", /className="toolbar-input[\s"]/],
  ["Select", /className="toolbar-select[\s"]/],
  ["Kbd", /<kbd[\s>]/],
  ["navItemClass", /["'`]nav-item[\s"'`]/],
  ["DataTable / table primitives (raw <table>)", /<table(?![^>]*np-matrix)[\s>]/],
  ["EmptyState", /className="[^"]*\bempty-state\b/],
  ["InlineBanner", /className="[^"]*\binline-banner(?![\w-])/],
  ["InlineBanner (legacy error/info banner)", /\b(error|info)-banner\b/],
  ["Button (raw button with design-system classes)", /<button[^>]*className="[^"]*\b(kb-btn[\w-]*|btn-primary|btn-ghost)\b/],
  ["KubebayMark (inline brand gradient)", /stopColor="#22d3ee"/],
];

// Files allowed a specific exception, with the reason.
const EXCEPTIONS: Record<string, string[]> = {
  // (The network-policy reachability matrix, table.np-matrix, is a grid visualisation,
  // not a data table; the pattern above skips it.)
};

describe("shell uses @kubebay/ui instead of hand-written patterns", () => {
  const files = tsxFiles(src).map((f) => [relative(src, f), readFileSync(f, "utf8")] as const);

  it.each(PATTERNS)("no hand-written %s markup", (_name, re) => {
    const offenders = files.filter(([f, text]) => re.test(text) && !(EXCEPTIONS[_name] ?? []).includes(f)).map(([f]) => f);
    expect(offenders).toEqual([]);
  });
});

describe("shell colours come from tokens", () => {
  // Data, not styling: theme swatches, user-picked cluster colours, chart series.
  const allowed = ["pages/Settings.tsx", "components/ClusterIconPicker.tsx", "components/PodGraphs.tsx"];
  const files = tsxFiles(src).map((f) => [relative(src, f), readFileSync(f, "utf8")] as const);

  it("no hex or rgb() colour literals in shell components", () => {
    const offenders = files
      .filter(([f]) => !allowed.includes(f))
      .flatMap(([f, text]) => [...text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?=["'`;)\s])|rgba?\(\s*\d/g)].map((m) => `${f}: ${m[0]}`));
    expect(offenders).toEqual([]);
  });
});

describe("forms", () => {
  // Button defaults to type="button" so it never submits by accident; a form's
  // submit button therefore has to ask for it. (TokenGate's Connect silently
  // stopped working when the default changed.)
  it("every Button inside a <form> declares its type", () => {
    const files = tsxFiles(src).map((f) => [relative(src, f), readFileSync(f, "utf8")] as const);
    const offenders = files.flatMap(([f, text]) =>
      [...text.matchAll(/<form[\s\S]*?<\/form>/g)].flatMap((m) =>
        [...m[0].matchAll(/<Button\b[^>]*>/g)].filter((b) => !/\btype=/.test(b[0])).map((b) => `${f}: ${b[0]}`),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
