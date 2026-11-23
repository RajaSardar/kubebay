// The shell's production build needs more than Node's default heap (about 2 GB):
// with sourcemaps on, `vite build` died with "JavaScript heap out of memory" on
// the macOS release runner and on a developer Mac (v0.8.1). The heap is raised in
// the package's own build script, so the Makefile, CI, release.yml and the
// Dockerfile, which all run `pnpm build`, get it on every platform, Windows too.
// Run: node --test scripts/web-build-heap.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "web/apps/shell/package.json"), "utf8"));

test("the shell build runs vite with a raised heap", () => {
  const build = pkg.scripts.build;
  const m = /^node --max-old-space-size=(\d+) node_modules\/vite\/bin\/vite\.js build$/.exec(build);
  assert.ok(m, `build script is ${JSON.stringify(build)}`);
  assert.ok(Number(m[1]) >= 6144, "at least 6 GB");
});
