/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Loading states follow one rule: a list or table that is still loading shows
// its own shape (skeleton rows under its real headers); a wait with no shape
// to sketch (detecting an operator, drawing a graph) shows the Spinner.
const src = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(src, p), "utf8");

describe("lists and tables load as skeletons", () => {
  it.each(["components/ResourceListView.tsx", "pages/Crds.tsx"])(
    "%s sketches its list instead of a spinner or bare text",
    (file) => {
      const text = read(file);
      expect(text).not.toMatch(/<PageLoader\b/);
      expect(text).toMatch(/<Skeleton(Table|Lines)\b/);
    },
  );

  it.each(["components/ResourceListView.tsx"])(
    "%s shows the refresh bar while cached rows re-sync",
    (file) => {
      expect(read(file)).toMatch(/<TableWrap[^>]*\bbusy=\{/);
    },
  );

  // The resource tables draw through the shared list view (docs/TABLE_UNIFICATION.md),
  // which carries the skeleton and refresh bar above; the page must use it and
  // must not fall back to a spinner.
  it.each(["pages/ResourceTable.tsx", "pages/Workloads.tsx"])(
    "%s renders its list through ResourceListView",
    (file) => {
      const text = read(file);
      expect(text).toMatch(/<ResourceListView\b/);
      expect(text).not.toMatch(/<PageLoader\b/);
    },
  );

  it("a lazily loaded page shows a skeleton, not a blank page, while its code loads", () => {
    const app = read("App.tsx");
    expect(app).not.toMatch(/<Suspense fallback=\{<div className="page" \/>\}>/);
    expect(app).toMatch(/<Suspense fallback=\{<PageSkeleton\b/);
  });
});

describe("drawers load as skeleton lines, not a word", () => {
  it.each(["components/GenericDrawer.tsx", "components/YamlTab.tsx", "components/RolloutProgress.tsx", "components/PodGraphs.tsx"])(
    "%s",
    (file) => {
      const text = read(file);
      expect(text).not.toMatch(/>Loading[^<]*…<\/div>/);
      expect(text).toMatch(/<SkeletonLines\b/);
    },
  );
});

describe("no page or component shows a bare loading word", () => {
  // A wait shows the helm-wheel Spinner (PageLoader for a page), skeleton rows
  // or skeleton lines, each saying what it waits for; never a plain "Loading…"
  // or "Waiting for…" string standing alone in the markup.
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = ["pages", "components"].flatMap((dir) =>
    readdirSync(resolve(src, dir))
      .filter((f: string) => f.endsWith(".tsx"))
      .map((f: string) => `${dir}/${f}`),
  );
  it.each(files)("%s", (file) => {
    const text = read(file);
    expect(text).not.toMatch(/<(p|div)\b[^>]*>\s*(Loading|Waiting for)[^<{]*…\s*</);
    expect(text).not.toMatch(/\?\s*"(Loading|Waiting for)[^"]*…"\s*:/);
  });

  it("every loading DataTable says what it loads", () => {
    for (const file of files) {
      const text = read(file);
      const tables = text.split("<DataTable").slice(1).map((t) => t.slice(0, 2500));
      for (const t of tables) {
        if (/\bloading=\{/.test(t)) expect(t, file).toMatch(/\bloadingLabel=/);
      }
    }
  });
});

