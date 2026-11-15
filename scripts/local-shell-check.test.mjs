// The desktop app's engine must carry the local shell (-tags localshell);
// every other build must not. Run: node --test scripts/local-shell-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobBlock } from "./workflow.mjs";
import { verdict } from "./local-shell-check.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const goBuilds = (block) => block.split("\n").filter((l) => /\bgo build\b/.test(l));

test("releases build the desktop app's engine with the local shell", () => {
  const desktop = jobBlock(read(".github/workflows/release.yml"), "desktop");
  const builds = goBuilds(desktop);
  // macOS arm64 and amd64 (lipo'd into one), and the Windows/Linux sidecar.
  assert.equal(builds.length, 3, builds.join("\n"));
  for (const line of builds) assert.match(line, /-tags localshell\b/, line);
});

test("the desktop smoke test builds the same engine and checks its shell", () => {
  const smoke = jobBlock(read(".github/workflows/ci.yml"), "desktop-smoke");
  const builds = goBuilds(smoke);
  assert.ok(builds.length >= 1, "the smoke job builds the sidecar");
  for (const line of builds) assert.match(line, /-tags localshell\b/, line);
  assert.match(smoke, /node scripts\/local-shell-check\.mjs --engine /);
  assert.match(smoke, /--expect-unsupported/, "Windows expects the platform's reason");
});

test("the standalone engine and the container image stay without it", () => {
  for (const line of goBuilds(jobBlock(read(".github/workflows/release.yml"), "engine-binaries"))) {
    assert.doesNotMatch(line, /localshell/, line);
  }
  assert.doesNotMatch(read("Dockerfile"), /localshell/);
});

test("passes only when the engine reports a shell it would start", () => {
  assert.deepEqual(verdict({ localShell: { available: true, enabled: true, shell: "bash" } }), { ok: true, message: "local shell available (bash)" });
  assert.deepEqual(verdict({ localShell: { available: false, enabled: true, reason: "local shell is not built into this binary" } }), {
    ok: false,
    message: "local shell unavailable: local shell is not built into this binary",
  });
  assert.equal(verdict({}).ok, false);
  assert.equal(verdict(null).ok, false);
});

// Windows has no local shell (no PTY teardown there), but its engine is still
// built with the tag, which turns "not built into this binary" into the
// platform's own reason.
test("on Windows, passes when the engine says the platform has no local shell", () => {
  const windows = { expectUnsupported: true };
  assert.deepEqual(verdict({ localShell: { available: false, enabled: true, reason: "local shell: lock: local shell is not supported on this platform" } }, windows), {
    ok: true,
    message: "local shell built in, and unsupported on this platform as expected",
  });
  assert.equal(verdict({ localShell: { available: false, enabled: true, reason: "local shell is not built into this binary (rebuild with -tags localshell)" } }, windows).ok, false);
  assert.equal(verdict({ localShell: { available: true, enabled: true } }, windows).ok, false);
});
