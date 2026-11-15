import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { COLUMNS, rows, standoutRows } from "./comparison";

// KB-02: every claim the comparison makes about any tool, Kubebay included,
// names where it comes from. A cell without a source fails the build.

const cells = rows.flatMap((r) => COLUMNS.map((c) => ({ feature: r.feature, column: c, cell: r[c] })));

describe("the comparison table", () => {
  it("has a source for every cell", () => {
    const missing = cells.filter(({ cell }) => !cell.source?.url).map(({ feature, column }) => `${feature} / ${column}`);
    expect(missing).toEqual([]);
  });

  it("links sources over https and says when each was checked", () => {
    for (const { feature, column, cell } of cells) {
      expect(cell.source.url, `${feature} / ${column}`).toMatch(/^https:\/\//);
      expect(cell.source.checked, `${feature} / ${column}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("makes no performance claim about another tool that Kubebay hasn't measured the same way", () => {
    // RAM, start-up time and installer size need the KB-02 harness first.
    for (const r of rows) expect(r.feature).not.toMatch(/ram|memory|cold start|start-up|installer/i);
    for (const { cell } of cells) expect(cell.label ?? "").not.toMatch(/\d\s?(MB|GB|s)\b/);
  });

  it("states Lens's free tier as Lens publishes it", () => {
    const price = rows.find((r) => r.feature === "Price")!;
    expect(price.lens.label).toMatch(/\$10M/);
  });
});

describe("the rest of the site", () => {
  // Numbers no harness has measured yet stay off the site (KB-02).
  it.each(["Hero.astro", "WhyKubebay.astro"])("%s claims no unmeasured RAM, start-up or installer figure", (file) => {
    const src = readFileSync(resolve(__dirname, "../components", file), "utf8");
    expect(src).not.toMatch(/≤\s?150 MB|≤\s?1\.5\s?s|40 MB installer|Engine running &mdash; \d+ MB/);
  });

  // Structured data is shown in search results; a rating Kubebay can't source
  // reads as fabricated reviews.
  it("SEO.astro publishes no review rating", () => {
    const src = readFileSync(resolve(__dirname, "../components/SEO.astro"), "utf8");
    expect(src).not.toMatch(/aggregateRating|ratingValue|ratingCount|reviewCount/);
  });

  // Copy only: CSS durations (`0.2s`, `--delay: 80ms`) aren't claims.
  const copy = (file: string) =>
    readFileSync(resolve(__dirname, "../components", file), "utf8")
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/\sstyle="[^"]*"/g, "");
  const components = readdirSync(resolve(__dirname, "../components")).filter((f) => f.endsWith(".astro"));
  const INSTALL_TIME =
    /\b(under|in|within)\s+(a|an|one|\d+)\s*(seconds?|secs?|minutes?|mins?)\b|\b(under|in|within)\s+\d+\s?s\b|\bin seconds\b|\b\d+[- ](second|minute)s?\b|totalTime/i;

  it("the install-time pattern catches rephrasings, not CSS", () => {
    for (const t of ["in under 2 minutes", "Install in 1 minute", "Get Kubebay in seconds", "Up and running in under a minute", "in 30s", "a 30-second install", "in 2 min"]) {
      expect(t).toMatch(INSTALL_TIME);
    }
    expect('<div style="--delay: 80ms"></div><style>a { transition: opacity 0.2s }</style>'.replace(/<style[\s\S]*?<\/style>/g, "").replace(/\sstyle="[^"]*"/g, "")).not.toMatch(INSTALL_TIME);
  });

  it.each(components)("%s claims no unmeasured install time", (file) => {
    expect(copy(file)).not.toMatch(INSTALL_TIME);
  });

  // The release the site names is the one the app is at.
  it("every version the site shows is the app's version", () => {
    const { version } = JSON.parse(readFileSync(resolve(__dirname, "../../../desktop/src-tauri/tauri.conf.json"), "utf8"));
    const shown = components.flatMap((file) =>
      [...copy(file).matchAll(/\bv(\d+\.\d+\.\d+)\b|softwareVersion:\s*'([^']+)'/g)].map((m) => `${file}: ${m[1] ?? m[2]}`),
    );
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter((s) => !s.endsWith(`: ${version}`))).toEqual([]);
  });
});

// The second table: what Kubebay does that Lens and Freelens, as documented,
// don't, or only behind a paywall. Same rule as the first: no cell without a
// source and the day it was checked.
const standoutCells = standoutRows.flatMap((r) =>
  (["kubebay", "lens", "freelens"] as const).map((c) => ({ feature: r.feature, column: c, cell: r[c] })),
);

describe("the 'where Kubebay goes further' table", () => {
  it("has a dozen or so rows in two groups", () => {
    expect(standoutRows.length).toBeGreaterThanOrEqual(10);
    expect(new Set(standoutRows.map((r) => r.group))).toEqual(new Set(["paid-in-lens", "undocumented"]));
  });

  it("has a source over https and a check date for every cell", () => {
    for (const { feature, column, cell } of standoutCells) {
      expect(cell.source?.url, `${feature} / ${column}`).toMatch(/^https:\/\//);
      expect(cell.source.checked, `${feature} / ${column}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("says a Lens feature is paid only on Lens's own pages", () => {
    for (const r of standoutRows) {
      if (/premium|plus|pro\b|enterprise/i.test(r.lens.label ?? "")) {
        expect(r.lens.source.url, r.feature).toMatch(/^https:\/\/(docs\.)?lenshq\.io\//);
      }
    }
  });

  it("explains what was checked wherever it says another tool lacks something", () => {
    for (const r of standoutRows) {
      for (const c of ["lens", "freelens"] as const) {
        if (r[c].kind === "no") expect(r[c].source.note, `${r.feature} / ${c}`).toMatch(/^.{30,}$/);
      }
    }
  });

  it("never marks Kubebay's own cell as missing", () => {
    expect(standoutRows.filter((r) => r.kubebay.kind === "no").map((r) => r.feature)).toEqual([]);
  });

  it("claims no performance figure for any tool", () => {
    for (const r of standoutRows) expect(r.feature).not.toMatch(/ram|memory|cold start|start-up|installer/i);
    for (const { cell } of standoutCells) expect(cell.label ?? "").not.toMatch(/\d\s?(MB|GB|s)\b/);
  });

  it("does not call a feature absent from Freelens when an official extension provides it", () => {
    // Re-checked 2026-11-12: official Resource Map (topology), Karpenter and Flux CD extensions exist.
    const features = standoutRows.map((r) => r.feature).join("\n");
    expect(features).not.toMatch(/topology|karpenter|keda/i);
  });

  it("holds back the in-cluster web app row until someone has checked the real Lens and Freelens apps", () => {
    expect(standoutRows.map((r) => r.feature).join("\n")).not.toMatch(/in a cluster|web app/i);
  });

  it("says where it looked whenever it says Freelens doesn't document something", () => {
    for (const r of standoutRows) {
      if (r.freelens.kind === "no") expect(r.freelens.source.note, r.feature).toMatch(/extension/i);
    }
  });

  it("states Lens's MCP server plan as Lens's pricing page and docs do: Plus or higher", () => {
    const mcp = standoutRows.find((r) => /MCP/i.test(r.feature))!;
    expect(mcp.lens.label).toMatch(/Plus or higher/);
    expect(mcp.lens.label).not.toMatch(/\bPro plan\b/);
  });

  it("says Freelens has community extensions for Argo CD and Trivy rather than nothing", () => {
    for (const re of [/Argo CD/, /Vulnerab/]) {
      const row = standoutRows.find((r) => re.test(r.feature))!;
      expect(row.freelens.label, row.feature).toMatch(/community/i);
    }
  });

  it("never claims what a Lens page doesn't itemise (details-panel tabs) is missing", () => {
    for (const r of standoutRows) {
      expect(r.lens.label ?? "", r.feature).not.toMatch(/\blacks\b|\bno \w+ tab\b/i);
      expect(r.freelens.label ?? "", r.feature).not.toMatch(/\blacks\b/i);
    }
  });

  it("is shown on the site, and the site names no single check date", () => {
    const src = readFileSync(resolve(__dirname, "../components/Comparison.astro"), "utf8");
    expect(src).toContain("standoutRows");
    expect(src).not.toMatch(/checked on \d{1,2} \w+ 20\d\d/i);
  });
});
