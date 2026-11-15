/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Local-first: the shell loads nothing from another origin. A third-party
// stylesheet or font tells that host every time Kubebay opens, and offline or
// air-gapped it silently isn't there.
const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("the shell is self-hosted", () => {
  it("index.html links and loads nothing from another origin", () => {
    const tags = read("index.html").match(/<(link|script)\b[^>]*>/g) ?? [];
    const remote = tags.filter((t) => /\b(href|src)="(https?:)?\/\//.test(t));
    expect(remote).toEqual([]);
  });

  it("every font the Display settings offer by name ships with the app", () => {
    const display = read("src/lib/display.ts");
    const main = read("src/main.tsx");
    const named = [...display.matchAll(/^\s+\w+: '"([^"]+)"/gm)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    for (const family of named) {
      const pkg = `@fontsource/${family.toLowerCase().replace(/\s+/g, "-")}`;
      expect(main, `${family} is imported from ${pkg}`).toContain(`import "${pkg}/`);
    }
  });
});
