// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Rollup } from "vite";
import { shipMinified } from "./shipMinified";

const monaco = "/w/node_modules/.pnpm/monaco-editor@0.56.0/node_modules/monaco-editor/esm/vs/editor/editor.api.js";
const app = "/w/apps/shell/src/lib/api.ts";
const source = "export function   longName ( first , second ) {\n  // a comment\n  return first   +   second;\n}\n";

function bundle(): Rollup.OutputBundle {
  const chunk = (fileName: string, moduleIds: string[]) => ({ type: "chunk", fileName, moduleIds, code: source, map: {} });
  const map = (fileName: string) => ({ type: "asset", fileName, source: "{}" });
  return {
    "assets/monacoBundle-a.js": chunk("assets/monacoBundle-a.js", [monaco]),
    "assets/monacoBundle-a.js.map": map("assets/monacoBundle-a.js.map"),
    // Monaco's lazy language loaders pull in Vite's preload helper.
    "assets/monaco-c.js": chunk("assets/monaco-c.js", [monaco, "\0vite/preload-helper.js"]),
    "assets/monaco-c.js.map": map("assets/monaco-c.js.map"),
    "assets/index-b.js": chunk("assets/index-b.js", [app, monaco]),
    "assets/index-b.js.map": map("assets/index-b.js.map"),
  } as unknown as Rollup.OutputBundle;
}

async function run(b: Rollup.OutputBundle) {
  const hook = shipMinified("monaco-editor").generateBundle as unknown as (o: unknown, b: Rollup.OutputBundle) => Promise<void>;
  await hook.call({}, {}, b);
  return b;
}

describe("shipMinified", () => {
  it("minifies a chunk made only of the package's code and drops its source map", async () => {
    const b = await run(bundle());
    const out = b["assets/monacoBundle-a.js"] as { code: string; map: unknown };
    expect(out.code.length).toBeLessThan(source.length);
    expect(out.code).not.toMatch(/a comment|sourceMappingURL/);
    expect(out.map).toBeNull();
    expect(b["assets/monacoBundle-a.js.map"]).toBeUndefined();
  });

  it("doesn't count the bundler's own glue as app code", async () => {
    const b = await run(bundle());
    expect((b["assets/monaco-c.js"] as { code: string }).code.length).toBeLessThan(source.length);
    expect(b["assets/monaco-c.js.map"]).toBeUndefined();
  });

  it("leaves chunks with the app's own code readable and mapped", async () => {
    const b = await run(bundle());
    expect((b["assets/index-b.js"] as { code: string }).code).toBe(source);
    expect(b["assets/index-b.js.map"]).toBeDefined();
  });
});
