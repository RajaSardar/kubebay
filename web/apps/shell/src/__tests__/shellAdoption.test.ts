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
];

describe("shell uses @kubebay/ui instead of hand-written patterns", () => {
  const files = tsxFiles(src).map((f) => [relative(src, f), readFileSync(f, "utf8")] as const);

  it.each(PATTERNS)("no hand-written %s markup", (_name, re) => {
    const offenders = files.filter(([, text]) => re.test(text)).map(([f]) => f);
    expect(offenders).toEqual([]);
  });
});
