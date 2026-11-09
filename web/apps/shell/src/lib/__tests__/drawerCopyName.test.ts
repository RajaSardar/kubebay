/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Root backlog #21: every kind's name can be copied. Each drawer in the app
// shows one resource (a pod, a release, a chart, a workload), so each passes
// its name to Drawer's copyName; a new drawer fails here until it does.

const SRC = resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sourceFiles(p);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : [];
  });
}

describe("drawers", () => {
  it("each offer Copy name for the resource they show", () => {
    const missing: string[] = [];
    let drawers = 0;
    for (const file of sourceFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<Drawer\b([\s\S]*?)\n\s*(?:actions|>)/g)) {
        drawers++;
        if (!m[1]!.includes("copyName=")) missing.push(`${relative(SRC, file)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(drawers).toBeGreaterThanOrEqual(5);
    expect(missing, "pass copyName={…} to <Drawer>").toEqual([]);
  });
});
