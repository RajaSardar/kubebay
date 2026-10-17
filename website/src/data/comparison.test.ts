import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COLUMNS, rows } from "./comparison";

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

  it.each(["SEO.astro", "Download.astro"])("%s claims no unmeasured install time", (file) => {
    const src = readFileSync(resolve(__dirname, "../components", file), "utf8");
    expect(src).not.toMatch(/under \d+ minutes?|in \d+ (seconds|minutes)|totalTime/i);
  });
});
