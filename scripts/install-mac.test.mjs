// install-mac.sh replaces /Applications/Kubebay.app and strips macOS's quarantine
// flag, so it must prove the DMG is the release's before it does either: the
// checksum the release publishes next to it, and the cosign signature when
// cosign is installed. These run the real script against stand-in curl, hdiutil,
// xattr and cosign commands, with the install directory in a temp folder.
// Run: node --test scripts/install-mac.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "install-mac.sh");
const DMG = "Kubebay_0.9.0_universal.dmg";
const sha = (s) => createHash("sha256").update(s).digest("hex");

// A sandbox: a "release" folder the fake curl serves from, a fake hdiutil whose
// mounted volume holds a Kubebay.app, and a log of the commands the script ran.
function sandbox({ files = {}, cosign = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kb-install-"));
  const release = join(dir, "release");
  const bin = join(dir, "bin");
  const apps = join(dir, "Applications");
  for (const d of [release, bin, apps]) mkdirSync(d);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(release, name), body);
  const log = join(dir, "calls.log");
  writeFileSync(log, "");

  const stub = (name, body) => {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  // curl -fsSL [--progress-bar] [-o out] URL : serve release/<basename>, 22 if absent
  stub("curl", `
url="\${@: -1}"; out=""
while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
f="${release}/$(basename "$url")"
echo "curl $url" >> "${log}"
[ -f "$f" ] || exit 22
if [ -n "$out" ]; then cp "$f" "$out"; else cat "$f"; fi`);
  stub("hdiutil", `
echo "hdiutil $*" >> "${log}"
if [ "$1" = "attach" ]; then
  while [ $# -gt 0 ]; do [ "$1" = "-mountpoint" ] && mp="$2"; shift; done
  mkdir -p "$mp/Kubebay.app/Contents" && echo "fresh" > "$mp/Kubebay.app/Contents/marker"
fi`);
  stub("xattr", `echo "xattr $*" >> "${log}"`);
  if (cosign !== null) stub("cosign", `echo "cosign $*" >> "${log}"; exit ${cosign}`);

  const run = (args = [], env = {}) =>
    spawnSync(process.env.KB_BASH ?? "bash", [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, KUBEBAY_INSTALL_DIR: apps, ...env },
    });
  const calls = () => readFileSync(log, "utf8");
  const installed = () => existsSync(join(apps, "Kubebay.app/Contents/marker"));
  return { run, calls, installed, apps, dir };
}

const good = (extra = {}) => ({ [DMG]: "dmg-bytes", [`${DMG}.sha256`]: `${sha("dmg-bytes")}  ${DMG}\n`, ...extra });

test("installs when the checksum matches, and only then clears the quarantine flag", () => {
  const sb = sandbox({ files: good() });
  const r = sb.run(["v0.9.0"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(sb.installed(), "the app was not copied in");
  assert.match(sb.calls(), /xattr -dr com\.apple\.quarantine/);
});

test("refuses a DMG whose checksum doesn't match, and touches nothing", () => {
  const sb = sandbox({ files: good({ [`${DMG}.sha256`]: `${sha("something else")}  ${DMG}\n` }) });
  mkdirSync(join(sb.apps, "Kubebay.app/Contents"), { recursive: true });
  writeFileSync(join(sb.apps, "Kubebay.app/Contents/marker"), "old");
  const r = sb.run(["v0.9.0"]);
  assert.notEqual(r.status, 0, "a tampered download was installed");
  assert.match(r.stderr + r.stdout, /checksum/i);
  assert.equal(readFileSync(join(sb.apps, "Kubebay.app/Contents/marker"), "utf8"), "old", "the existing app was replaced");
  assert.doesNotMatch(sb.calls(), /xattr|hdiutil attach/, "it mounted or un-quarantined an unverified DMG");
});

test("refuses a release with no published checksum unless told to go ahead", () => {
  const files = { [DMG]: "dmg-bytes" };
  const refused = sandbox({ files }).run(["v0.9.0"]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr + refused.stdout, /checksum/i);

  const sb = sandbox({ files });
  const allowed = sb.run(["v0.9.0"], { KUBEBAY_INSTALL_UNVERIFIED: "1" });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stderr + allowed.stdout, /unverified/i, "it should say it skipped verification");
  assert.ok(sb.installed());
});

test("with cosign installed, a bad signature stops the install and a good one lets it through", () => {
  const files = good({ [`${DMG}.cosign.bundle`]: "{}" });
  const bad = sandbox({ files, cosign: 1 });
  const r = bad.run(["v0.9.0"]);
  assert.notEqual(r.status, 0, "an unsigned or wrongly signed DMG was installed");
  assert.match(r.stderr + r.stdout, /signature/i);
  assert.ok(!bad.installed());

  const ok = sandbox({ files, cosign: 0 });
  assert.equal(ok.run(["v0.9.0"]).status, 0);
  assert.ok(ok.installed());
  // it checks the release workflow's identity at a release tag, not just any signature
  assert.match(ok.calls(), /--certificate-identity-regexp .*RajaSardar\/kubebay\/\\\.github\/workflows\/release\\\.yml@refs\/tags\/v/);
  assert.match(ok.calls(), /--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/);
});

test("a version that isn't a version never reaches a URL or a path", () => {
  for (const v of ["../../etc", "v1.0.0/../x", "v1.0.0;rm -rf ~", "$(id)", "v1 .0"]) {
    const sb = sandbox({ files: good() });
    const r = sb.run([v]);
    assert.notEqual(r.status, 0, `${v} was accepted`);
    assert.equal(sb.calls(), "", `${v} reached curl or hdiutil`);
  }
});

// The script refuses a release with no checksum, so the release workflow has to publish one for
// the DMG, and has to do it before the signing step so the checksum is signed too.
test("the release workflow publishes a SHA-256 for each desktop installer before it signs the assets", () => {
  const wf = readFileSync(join(dirname(script), "..", ".github/workflows/release.yml"), "utf8");
  const sign = wf.indexOf("Sign every release asset");
  assert.ok(sign > 0, "release.yml signs every asset");
  const sums = wf.indexOf(".sha256", wf.indexOf("Kubebay_"));
  assert.ok(sums > 0 && sums < sign, "no step writes a .sha256 for the Kubebay_* installers ahead of the signing step");
  assert.match(wf.slice(0, sign), /for f in (dist\/)?Kubebay_\*|Kubebay_\*[\s\S]{0,200}\.sha256/);
});
