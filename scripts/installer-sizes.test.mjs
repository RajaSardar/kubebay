// KB-02 step 1: every installer a release produces is weighed against the
// previous release's, and growth over 10% is flagged. Run: node --test scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { assetKey, compareSizes, isInstaller, summaryMarkdown, warnings } from "./installer-sizes.mjs";

test("names the same installer across versions alike", () => {
  assert.equal(assetKey("Kubebay_0.6.0_universal.dmg"), "Kubebay_{version}_universal.dmg");
  assert.equal(assetKey("Kubebay_0.7.0_universal.dmg"), "Kubebay_{version}_universal.dmg");
  assert.equal(assetKey("Kubebay-v0.6.0-macos.zip"), "Kubebay-v{version}-macos.zip");
  assert.equal(assetKey("Kubebay_0.6.0_x64-setup.exe"), "Kubebay_{version}_x64-setup.exe");
  assert.equal(assetKey("kubebay-linux-amd64.tar.gz"), "kubebay-linux-amd64.tar.gz");
  assert.equal(assetKey("Kubebay_1.0.0-rc.1_amd64.AppImage"), "Kubebay_{version}_amd64.AppImage");
});

test("weighs installers and archives, not checksums, signatures, SBOMs or scripts", () => {
  for (const n of ["Kubebay_0.6.0_universal.dmg", "Kubebay_0.6.0_x64-setup.exe", "Kubebay_0.6.0_amd64.deb", "Kubebay_0.6.0_amd64.AppImage", "Kubebay-v0.6.0-macos.zip", "kubebay-linux-amd64.tar.gz", "Kubebay_0.6.0_x64_en-US.msi", "kubebay-0.6.0.x86_64.rpm"]) {
    assert.ok(isInstaller(n), n);
  }
  for (const n of ["kubebay-linux-amd64.tar.gz.sha256", "Kubebay_0.6.0_universal.dmg.cosign.bundle", "sbom.json", "sbom-go.json", "install-mac.sh", "installer-sizes.json"]) {
    assert.ok(!isInstaller(n), n);
  }
});

const previous = [
  { name: "Kubebay_0.6.0_universal.dmg", size: 52_892_035 },
  { name: "Kubebay_0.6.0_x64-setup.exe", size: 19_213_098 },
  { name: "Kubebay_0.6.0_amd64.AppImage", size: 102_443_512 },
  { name: "kubebay-linux-amd64.tar.gz.sha256", size: 93 },
];
const current = [
  { name: "Kubebay_0.7.0_universal.dmg", size: 60_000_000 }, // +13.4%
  { name: "Kubebay_0.7.0_x64-setup.exe", size: 19_500_000 }, // +1.5%
  { name: "Kubebay_0.7.0_amd64.deb", size: 27_000_000 }, // new
  { name: "kubebay-linux-amd64.tar.gz.sha256", size: 93 },
];

test("compares each installer with the previous release's", () => {
  const rows = compareSizes(current, previous, 0.1);
  assert.deepEqual(
    rows.map((r) => [r.name, r.status, r.growth === null ? null : Math.round(r.growth * 1000) / 10]),
    [
      ["Kubebay_0.7.0_amd64.deb", "new", null],
      ["Kubebay_0.7.0_universal.dmg", "over", 13.4],
      ["Kubebay_0.7.0_x64-setup.exe", "ok", 1.5],
    ],
  );
});

test("a first release has nothing to compare with", () => {
  assert.ok(compareSizes(current, [], 0.1).every((r) => r.status === "new"));
});

test("warns for each installer over the threshold, in GitHub's annotation format", () => {
  const lines = warnings(compareSizes(current, previous, 0.1), "v0.6.0");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^::warning title=Installer size::Kubebay_0\.7\.0_universal\.dmg is 13\.4% larger than in v0\.6\.0 \(50\.4 MiB → 57\.2 MiB\)/);
});

test("writes a summary table with sizes and growth", () => {
  const md = summaryMarkdown(compareSizes(current, previous, 0.1), { tag: "v0.7.0", previousTag: "v0.6.0", threshold: 0.1 });
  assert.match(md, /\| Kubebay_0\.7\.0_universal\.dmg \| 57\.2 MiB \| 50\.4 MiB \| \+13\.4% ⚠️ \|/);
  assert.match(md, /\| Kubebay_0\.7\.0_amd64\.deb \| 25\.7 MiB \| – \| new \|/);
  assert.match(md, /more than 10% larger than in v0\.6\.0/);
});
