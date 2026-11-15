// The desktop app updates itself only when the build carries the updater's public key
// (Settings -> Updates says "This build doesn't update itself" when it doesn't). The key is
// public, so it can live in a repository variable or a secret; the release workflow has to
// find it in either, and a build made on a developer's machine has to carry it too.
// Run: node --test scripts/updater-key.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("release.yml reads the updater public key from a variable or a secret", () => {
  const wf = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
  const line = wf.match(/^\s*TAURI_UPDATER_PUBKEY:\s*(.+)$/m);
  assert.ok(line, "release.yml sets TAURI_UPDATER_PUBKEY");
  assert.match(line[1], /vars\.TAURI_UPDATER_PUBKEY/);
  assert.match(
    line[1],
    /secrets\.TAURI_UPDATER_PUBKEY/,
    "a key stored as a secret is ignored, and the release ships without an updater",
  );
});

const dry = (file) =>
  spawnSync("make", ["-n", "desktop", `UPDATER_PUBKEY_FILE=${file}`], { cwd: root, encoding: "utf8" }).stdout;

test("make desktop builds the app with the updater key when the key file exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-key-"));
  const pub = join(dir, "key.pub");
  writeFileSync(pub, "dW50cnVzdGVkIGNvbW1lbnQ6IHRlc3Q=\n"); // a trailing newline, as `tauri signer generate` writes
  const out = dry(pub);
  const build = out.split("\n").find((l) => l.includes("tauri build"));
  assert.ok(build, `no tauri build in:\n${out}`);
  assert.match(build, /--config '\{"plugins":\{"updater":\{"pubkey":"dW50cnVzdGVkIGNvbW1lbnQ6IHRlc3Q=","requireSignedVersion":true\}\}\}'/);
  assert.ok(!build.includes("\n"), "the key's newline leaked into the command");
  assert.match(out, /cp engine\/bin\/kubebay desktop\/src-tauri\/binaries\/kubebay-engine-aarch64-apple-darwin/, "the new engine has to be the sidecar");
});

test("make desktop still builds without a key file, and says the app won't update itself", () => {
  const out = dry(join(tmpdir(), "kb-no-such-key.pub"));
  const build = out.split("\n").find((l) => l.includes("tauri build"));
  assert.ok(build, "no tauri build");
  assert.doesNotMatch(build, /--config/);
  assert.match(out, /won't update itself/i);
});
