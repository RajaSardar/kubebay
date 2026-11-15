// KB-02 step 3: the desktop cold-start script. Run: node --test scripts/desktop-cold-start.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measure } from "./desktop-cold-start.mjs";

function fakeApp(body) {
  const dir = mkdtempSync(join(tmpdir(), "kb-app-"));
  const app = join(dir, "Kubebay");
  writeFileSync(app, `#!/bin/sh\n${body}\n`);
  chmodSync(app, 0o755);
  return app;
}

test("times each smoke run from launch to exit and reports the median", async () => {
  // Stands in for the app: exits 0 once "painted", and only in a smoke run.
  const app = fakeApp('[ "$KUBEBAY_SMOKE" = 1 ] || exit 3\nsleep 0.2');
  const r = await measure(app, 3);
  assert.equal(r.runs.length, 3);
  for (const ms of r.runs) assert.ok(ms >= 200 && ms < 5000, `${ms}`);
  assert.equal(r.medianMs, [...r.runs].sort((a, b) => a - b)[1]);
});

test("a smoke run that fails is an error, not a number", async () => {
  await assert.rejects(measure(fakeApp("exit 1"), 3), /exited with 1/);
});
