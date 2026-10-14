// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Rollup } from "vite";
import { staysLazy } from "./staysLazy";

const monaco = "/w/node_modules/.pnpm/monaco-editor@0.56.0/node_modules/monaco-editor/esm/vs/editor/editor.api.js";
const app = "/w/apps/shell/src/main.tsx";

function chunk(fileName: string, moduleIds: string[], imports: string[] = [], dynamicImports: string[] = [], isEntry = false) {
  return { type: "chunk", fileName, moduleIds, imports, dynamicImports, isEntry, code: "" };
}

function run(bundle: Record<string, unknown>) {
  const errors: string[] = [];
  const ctx = { error: (m: string) => { errors.push(m); throw new Error(m); } };
  const hook = staysLazy("monaco-editor").generateBundle as unknown as (this: typeof ctx, o: unknown, b: Rollup.OutputBundle) => void;
  try {
    hook.call(ctx, {}, bundle as unknown as Rollup.OutputBundle);
  } catch {
    // reported through ctx.error
  }
  return errors;
}

describe("staysLazy", () => {
  it("passes when the package is only reached through a dynamic import", () => {
    expect(
      run({
        "index.js": chunk("index.js", [app], ["preload.js"], ["monaco.js"], true),
        "preload.js": chunk("preload.js", ["\0vite/preload-helper.js"]),
        "monaco.js": chunk("monaco.js", [monaco], ["preload.js"]),
      }),
    ).toEqual([]);
  });

  it("fails the build when the entry statically imports a chunk holding the package, and says how", () => {
    const errors = run({
      "index.js": chunk("index.js", [app], ["shared.js"], [], true),
      "shared.js": chunk("shared.js", ["/w/apps/shell/src/lib/util.ts"], ["monaco.js"]),
      "monaco.js": chunk("monaco.js", [monaco, "\0vite/preload-helper.js"]),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/monaco-editor/);
    expect(errors[0]).toMatch(/index\.js → shared\.js → monaco\.js/);
  });
});
