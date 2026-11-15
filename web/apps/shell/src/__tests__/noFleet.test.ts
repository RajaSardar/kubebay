/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// The owner removed the Fleet view as unnecessary: no nav entry, no page,
// and an old /fleet bookmark lands on the clusters list instead of a blank page.
const src = resolve(__dirname, "..");

describe("Fleet is gone", () => {
  it("has no nav entry, page or lazy import", () => {
    const app = readFileSync(resolve(src, "App.tsx"), "utf8");
    expect(app).not.toMatch(/label: "Fleet"/);
    expect(app).not.toMatch(/import\("\.\/pages\/Fleet"\)/);
    expect(existsSync(resolve(src, "pages/Fleet.tsx"))).toBe(false);
  });

  it("redirects an old /fleet link to the clusters list", () => {
    const app = readFileSync(resolve(src, "App.tsx"), "utf8");
    expect(app).toMatch(/<Route path="\/fleet" element=\{<Navigate to="\/clusters" replace \/>\} \/>/);
  });
});
