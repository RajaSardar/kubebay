/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ADR 0005: the terminal dock loads with the app, but xterm must not. Nothing
// App.tsx imports statically may reach @xterm/*: the dock's shell, like the
// pod terminal, is a lazy chunk. An import graph, not a chunk-size number,
// so the test says which import broke it.

const SRC = resolve(__dirname, "..");
const UI = resolve(__dirname, "../../../../packages/ui/src");

// Static imports only: `import x from "y"`, `import "y"`, `export … from "y"`.
// `import type` is erased; `import("y")` is lazy.
const STATIC = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;

function resolveLocal(from: string, spec: string): string | null {
  const base = spec === "@kubebay/ui" ? resolve(UI, "index") : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && !p.endsWith("/")) {
      try {
        readFileSync(p, "utf8");
        return p;
      } catch {
        /* a directory */
      }
    }
  }
  return null;
}

function staticGraph(entry: string) {
  const seen = new Map<string, string[]>();
  const external = new Map<string, string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    const deps: string[] = [];
    seen.set(file, deps);
    for (const m of readFileSync(file, "utf8").matchAll(STATIC)) {
      const spec = m[1]!;
      const local = resolveLocal(file, spec);
      if (local) {
        deps.push(local);
        stack.push(local);
      } else if (!external.has(spec)) external.set(spec, file);
    }
  }
  return { files: [...seen.keys()], external };
}

describe("the main chunk", () => {
  const { files, external } = staticGraph(resolve(SRC, "App.tsx"));

  it("reaches the dock, so it's there from the start", () => {
    expect(files.some((f) => f.endsWith("components/TerminalDock.tsx"))).toBe(true);
  });

  it("is checked by a walker that does find xterm where it's imported: the dock's lazy shell", () => {
    expect(staticGraph(resolve(SRC, "components/DockShell.tsx")).external.has("@xterm/xterm")).toBe(true);
  });

  it("never reaches xterm", () => {
    const xterm = [...external].filter(([spec]) => spec.startsWith("@xterm/")).map(([spec, from]) => `${spec} ← ${from.replace(SRC, "src")}`);
    expect(xterm).toEqual([]);
  });
});
