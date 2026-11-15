/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// The cluster a view shows is the one the user opened (the cluster store), never
// "the first reachable one" from /api/clusters: that fallback streamed clusters
// nobody opened, showed the palette and the CRD sidebar for the wrong cluster,
// and reconnected a cluster the moment it was disconnected.
const src = resolve(__dirname, "..");
const files = ["App.tsx", ...["pages", "components", "lib"].flatMap((d) =>
  readdirSync(resolve(src, d)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${d}/${f}`),
)];

describe("no view falls back to the first reachable cluster", () => {
  it.each(files)("%s", (file) => {
    const text = readFileSync(resolve(src, file), "utf8");
    expect(text).not.toMatch(/\.find\(\(c\) => c\.status === "(connected|reachable)"\)/);
  });
});
