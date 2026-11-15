/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loader } from "@monaco-editor/react";

// Stands in for the real bundle: jsdom can't run Monaco itself.
const bundled = vi.hoisted(() => ({ editor: {}, languages: {} }));
vi.mock("../monacoBundle", () => ({ monaco: bundled }));

import { loadMonaco } from "../monaco";

describe("Monaco loads from the app bundle", () => {
  it("hands the editor the bundled Monaco and never fetches one from a CDN", async () => {
    await loadMonaco();
    await expect(loader.init()).resolves.toBe(bundled);
    // @monaco-editor/loader's fallback injects <script src="https://cdn.jsdelivr.net/…/loader.js">.
    expect(document.querySelectorAll("script")).toHaveLength(0);
  });
});

describe("every editor goes through lib/monaco", () => {
  const src = resolve(__dirname, "../..");
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" ? [] : files(p);
      return /\.tsx?$/.test(e.name) ? [p] : [];
    });

  it("no file imports @monaco-editor/react's components directly", () => {
    const offenders = files(src)
      .filter((f) => relative(src, f) !== join("lib", "monaco.tsx"))
      .filter((f) => /^import\s+(?!type\b)[^;]*from\s+["']@monaco-editor\/react["']/m.test(readFileSync(f, "utf8")))
      .map((f) => relative(src, f));
    expect(offenders).toEqual([]);
  });
});
