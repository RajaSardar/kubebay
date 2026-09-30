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
  it.each(["pages/Workloads.tsx", "components/ResourceListView.tsx", "pages/Crds.tsx"])(
    "%s sketches its list instead of a spinner or bare text",
    (file) => {
      const text = read(file);
      expect(text).not.toMatch(/<PageLoader\b/);
      expect(text).toMatch(/<Skeleton(Table|Lines)\b/);
    },
  );

  it.each(["pages/Workloads.tsx", "components/ResourceListView.tsx"])(
    "%s shows the refresh bar while cached rows re-sync",
    (file) => {
      expect(read(file)).toMatch(/<TableWrap[^>]*\bbusy=\{/);
    },
  );

  // The resource tables draw through the shared list view (docs/TABLE_UNIFICATION.md),
  // which carries the skeleton and refresh bar above; the page must use it and
  // must not fall back to a spinner.
  it("pages/ResourceTable.tsx renders its list through ResourceListView", () => {
    const text = read("pages/ResourceTable.tsx");
    expect(text).toMatch(/<ResourceListView\b/);
    expect(text).not.toMatch(/<PageLoader\b/);
  });

  it("a lazily loaded page shows a skeleton, not a blank page, while its code loads", () => {
    const app = read("App.tsx");
    expect(app).not.toMatch(/<Suspense fallback=\{<div className="page" \/>\}>/);
    expect(app).toMatch(/<Suspense fallback=\{<PageSkeleton\b/);
  });

  it("the fleet view sketches its cluster cards", () => {
    expect(read("pages/Fleet.tsx")).not.toMatch(/title="Loading clusters…"/);
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
