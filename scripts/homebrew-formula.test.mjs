// The release's homebrew-tap job writes the formula behind
// `brew install rajasardar/tap/kubebay`, on macOS and Linux.
// Run: node --test scripts/homebrew-formula.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// `brew install rajasardar/tap/kubebay` works on Linux too, so the formula the
// release writes has to download from the tag (v0.9.0, not 0.9.0) and carry the
// Linux tarballs' real checksums. GITHUB_TOKEN can't push to the tap repository
// (v0.8.0's job failed with a 403), so it needs a token that can.
test("the release writes a Homebrew formula that installs on macOS and Linux", () => {
  const wf = readFileSync(join(here, "..", ".github/workflows/release.yml"), "utf8");
  const job = wf.slice(wf.indexOf("homebrew-tap:"));
  assert.doesNotMatch(job, /LINUX_PLACEHOLDER/);
  assert.doesNotMatch(job, /releases\/download\/#\{version\}\//, "formula URLs drop the tag's v");
  for (const a of ["linux-arm64", "linux-amd64", "darwin-arm64", "darwin-amd64"]) {
    assert.match(job, new RegExp(`releases/download/v#\\{version\\}/kubebay-${a}\\.tar\\.gz`));
    assert.match(job, new RegExp(`\\$\\(sum ${a}\\)|download/\\$TAG/kubebay-${a}\\.tar\\.gz\\.sha256`), `no checksum fetched for ${a}`);
  }
  assert.match(job, /secrets\.HOMEBREW_TAP_TOKEN/);
});
