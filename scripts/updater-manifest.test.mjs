// KB-04: the updater manifest (latest.json). Run: node --test scripts/updater-manifest.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifest, platformsFor } from "./updater-manifest.mjs";

test("maps each signed bundle to the updater targets that install it", () => {
  assert.deepEqual(platformsFor("Kubebay_0.8.0_universal.app.tar.gz"), ["darwin-aarch64-app", "darwin-x86_64-app", "darwin-aarch64", "darwin-x86_64"]);
  assert.deepEqual(platformsFor("Kubebay_0.8.0_x64-setup.exe"), ["windows-x86_64-nsis", "windows-x86_64"]);
  assert.deepEqual(platformsFor("Kubebay_0.8.0_x64_en-US.msi"), ["windows-x86_64-msi"]);
  // Linux has no bare key: a .deb install must never be handed the AppImage.
  assert.deepEqual(platformsFor("Kubebay_0.8.0_amd64.AppImage"), ["linux-x86_64-appimage"]);
  assert.deepEqual(platformsFor("Kubebay_0.8.0_amd64.deb"), ["linux-x86_64-deb"]);
  assert.deepEqual(platformsFor("Kubebay-0.8.0-1.x86_64.rpm"), ["linux-x86_64-rpm"]);
  assert.deepEqual(platformsFor("Kubebay_0.8.0_universal.dmg"), []);
  assert.deepEqual(platformsFor("kubebay-darwin-arm64.tar.gz"), []);
});

function dist(files) {
  const dir = mkdtempSync(join(tmpdir(), "updater-manifest-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

test("builds latest.json from the signed bundles in a directory", () => {
  const dir = dist({
    "Kubebay_0.8.0_universal.app.tar.gz": "app",
    "Kubebay_0.8.0_universal.app.tar.gz.sig": "c2lnLWFwcA==\n",
    "Kubebay_0.8.0_x64-setup.exe": "exe",
    "Kubebay_0.8.0_x64-setup.exe.sig": "c2lnLWV4ZQ==",
    "Kubebay_0.8.0_amd64.AppImage": "img",
    "Kubebay_0.8.0_amd64.AppImage.sig": "c2lnLWltZw==",
    // Not signed: left out.
    "Kubebay_0.8.0_amd64.deb": "deb",
    "Kubebay_0.8.0_universal.dmg": "dmg",
  });
  const m = manifest({ dir, tag: "v0.8.0", repo: "RajaSardar/kubebay", date: "2026-11-02T10:00:00Z" });
  const base = "https://github.com/RajaSardar/kubebay/releases/download/v0.8.0/";
  assert.equal(m.version, "0.8.0");
  assert.equal(m.pub_date, "2026-11-02T10:00:00Z");
  assert.equal(m.notes, "https://github.com/RajaSardar/kubebay/releases/tag/v0.8.0");
  assert.deepEqual(Object.keys(m.platforms).sort(), [
    "darwin-aarch64",
    "darwin-aarch64-app",
    "darwin-x86_64",
    "darwin-x86_64-app",
    "linux-x86_64-appimage",
    "windows-x86_64",
    "windows-x86_64-nsis",
  ]);
  assert.deepEqual(m.platforms["darwin-x86_64"], { signature: "c2lnLWFwcA==", url: base + "Kubebay_0.8.0_universal.app.tar.gz" });
  assert.deepEqual(m.platforms["windows-x86_64"], { signature: "c2lnLWV4ZQ==", url: base + "Kubebay_0.8.0_x64-setup.exe" });
  assert.deepEqual(m.platforms["linux-x86_64-appimage"], { signature: "c2lnLWltZw==", url: base + "Kubebay_0.8.0_amd64.AppImage" });
});

test("refuses to write a manifest with no signed bundles", () => {
  const dir = dist({ "Kubebay_0.8.0_universal.dmg": "dmg" });
  assert.throws(() => manifest({ dir, tag: "v0.8.0", repo: "RajaSardar/kubebay" }), /no signed update bundles/);
});

test("a signature without its bundle is an error, not a broken link", () => {
  const dir = dist({ "Kubebay_0.8.0_x64-setup.exe.sig": "c2ln" });
  assert.throws(() => manifest({ dir, tag: "v0.8.0", repo: "RajaSardar/kubebay" }), /Kubebay_0\.8\.0_x64-setup\.exe/);
});

// The release wiring: updater bundles and latest.json only when the signing
// key and its public half are both configured, and the app is built to
// require the signed version.
test("release.yml builds update bundles only with the key, and publishes latest.json", async () => {
  const { readFileSync } = await import("node:fs");
  const yml = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(yml, /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
  assert.match(yml, /TAURI_UPDATER_PUBKEY: \$\{\{ vars\.TAURI_UPDATER_PUBKEY \}\}/);
  assert.match(yml, /if \[ -n "\$TAURI_SIGNING_PRIVATE_KEY" \] && \[ -n "\$TAURI_UPDATER_PUBKEY" \]/);
  assert.match(yml, /"createUpdaterArtifacts":true/);
  assert.match(yml, /"requireSignedVersion":true/);
  assert.match(yml, /node scripts\/updater-manifest\.mjs --dir dist/);
});

// requireSignedVersion rejects a signature that doesn't carry the version it
// was signed for, and `tauri build` records it only from Tauri CLI 2.12.0.
test("the desktop build signs updates with the version they're for (Tauri CLI 2.12+)", async () => {
  const { readFileSync } = await import("node:fs");
  const lock = readFileSync(new URL("../desktop/pnpm-lock.yaml", import.meta.url), "utf8");
  const version = /'@tauri-apps\/cli':\s*\n\s*specifier: [^\n]+\n\s*version: (\d+)\.(\d+)\.(\d+)/.exec(lock);
  assert.ok(version, "desktop/pnpm-lock.yaml pins @tauri-apps/cli");
  const [major, minor] = [Number(version[1]), Number(version[2])];
  assert.ok(major > 2 || (major === 2 && minor >= 12), `@tauri-apps/cli ${version.slice(1).join(".")} doesn't record the signed version`);
});
