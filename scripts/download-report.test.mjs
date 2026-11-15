// KB-17 step 1: the monthly download report. Run: node --test scripts/download-report.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { channel, report, snapshot, summaryMarkdown } from "./download-report.mjs";

test("sorts each download into the channel a user got Kubebay from", () => {
  assert.equal(channel("Kubebay_0.6.0_universal.dmg"), "macOS app");
  assert.equal(channel("Kubebay-v0.6.0-macos.zip"), "macOS app");
  // Earlier releases' app zips, named by target.
  assert.equal(channel("Kubebay-v0.4.0-aarch64-apple-darwin.zip"), "macOS app");
  assert.equal(channel("Kubebay-v0.2.0-macOS-arm64.zip"), "macOS app");
  assert.equal(channel("Kubebay_0.6.0_x64-setup.exe"), "Windows app");
  assert.equal(channel("Kubebay_0.6.0_x64_en-US.msi"), "Windows app");
  assert.equal(channel("Kubebay_0.6.0_amd64.deb"), "Linux app");
  assert.equal(channel("Kubebay-0.6.0-1.x86_64.rpm"), "Linux app");
  assert.equal(channel("Kubebay_0.6.0_amd64.AppImage"), "Linux app");
  // The Homebrew formula downloads these, so brew installs are counted here.
  assert.equal(channel("kubebay-darwin-arm64.tar.gz"), "Engine, macOS (Homebrew)");
  assert.equal(channel("kubebay-linux-amd64.tar.gz"), "Engine, Linux");
  assert.equal(channel("kubebay-windows-amd64.tar.gz"), "Engine, Windows");
  assert.equal(channel("kubebay-airgap-v0.8.0.tar.gz"), "Air-gapped bundle");
  assert.equal(channel("install-mac.sh"), "Install script");
});

test("checksums, signatures, SBOMs and manifests aren't downloads of Kubebay", () => {
  for (const name of [
    "kubebay-darwin-arm64.tar.gz.sha256",
    "SHA256SUMS",
    "SHA256SUMS.cosign.bundle",
    "Kubebay_0.6.0_universal.dmg.cosign.bundle",
    "Kubebay_0.6.0_universal.dmg.sig",
    "sbom.json",
    "sbom-go.json",
    "installer-sizes.json",
    "latest.json",
    "provenance.intoto.jsonl",
  ]) {
    assert.equal(channel(name), null, name);
  }
});

const releasesApi = [
  {
    tag_name: "v0.6.0",
    published_at: "2026-10-02T18:45:43Z",
    draft: false,
    assets: [
      { name: "Kubebay_0.6.0_universal.dmg", download_count: 30 },
      { name: "Kubebay_0.6.0_universal.dmg.cosign.bundle", download_count: 2 },
      { name: "kubebay-darwin-arm64.tar.gz", download_count: 12 },
      { name: "Kubebay_0.6.0_amd64.deb", download_count: 5 },
    ],
  },
  {
    tag_name: "v0.5.0",
    published_at: "2026-10-01T09:13:54Z",
    draft: false,
    assets: [{ name: "Kubebay_0.5.0_universal.dmg", download_count: 9 }],
  },
  { tag_name: "v0.7.0", published_at: null, draft: true, assets: [{ name: "Kubebay_0.7.0_universal.dmg", download_count: 0 }] },
];
const repoApi = { stargazers_count: 41, forks_count: 3, subscribers_count: 5, open_issues_count: 7 };

test("a snapshot keeps published releases and their downloads only", () => {
  const s = snapshot(releasesApi, repoApi, "2026-11-01T06:17:00Z");
  assert.equal(s.date, "2026-11-01T06:17:00Z");
  assert.deepEqual(s.repo, { stars: 41, forks: 3, watchers: 5, openIssues: 7 });
  assert.deepEqual(
    s.releases.map((r) => r.tag),
    ["v0.6.0", "v0.5.0"],
  );
  assert.deepEqual(s.releases[0].assets, [
    { name: "Kubebay_0.6.0_universal.dmg", channel: "macOS app", downloads: 30 },
    { name: "kubebay-darwin-arm64.tar.gz", channel: "Engine, macOS (Homebrew)", downloads: 12 },
    { name: "Kubebay_0.6.0_amd64.deb", channel: "Linux app", downloads: 5 },
  ]);
});

test("totals all time, by channel and by release, without a previous month", () => {
  const r = report(snapshot(releasesApi, repoApi, "2026-11-01T06:17:00Z"));
  assert.equal(r.total, 56);
  assert.equal(r.sincePrevious, null);
  assert.deepEqual(r.byChannel, [
    { channel: "macOS app", total: 39, sincePrevious: null },
    { channel: "Engine, macOS (Homebrew)", total: 12, sincePrevious: null },
    { channel: "Linux app", total: 5, sincePrevious: null },
  ]);
  assert.deepEqual(r.byRelease, [
    { tag: "v0.6.0", published: "2026-10-02", total: 47, sincePrevious: null },
    { tag: "v0.5.0", published: "2026-10-01", total: 9, sincePrevious: null },
  ]);
});

test("counts what's new since the previous month's snapshot", () => {
  const previous = snapshot(
    [
      { tag_name: "v0.5.0", published_at: "2026-10-01T09:13:54Z", draft: false, assets: [{ name: "Kubebay_0.5.0_universal.dmg", download_count: 4 }] },
    ],
    { stargazers_count: 30, forks_count: 2, subscribers_count: 5, open_issues_count: 4 },
    "2026-10-01T06:17:00Z",
  );
  const r = report(snapshot(releasesApi, repoApi, "2026-11-01T06:17:00Z"), previous);
  // v0.6.0 is new: all 47 count. v0.5.0 went from 4 to 9.
  assert.equal(r.sincePrevious, 52);
  assert.equal(r.previousDate, "2026-10-01T06:17:00Z");
  assert.deepEqual(r.byRelease.map((x) => [x.tag, x.sincePrevious]), [
    ["v0.6.0", 47],
    ["v0.5.0", 5],
  ]);
  assert.equal(r.byChannel.find((c) => c.channel === "macOS app").sincePrevious, 35);
  assert.deepEqual(r.repo, { stars: 41, starsSincePrevious: 11, forks: 3, watchers: 5, openIssues: 7 });
});

test("writes a summary with the totals, channels and releases", () => {
  const md = summaryMarkdown(report(snapshot(releasesApi, repoApi, "2026-11-01T06:17:00Z")));
  assert.match(md, /^### Downloads \(2026-11-01\)/);
  assert.match(md, /56 downloads of published releases, all time/);
  assert.match(md, /\| macOS app \| 39 \| – \|/);
  assert.match(md, /\| v0\.6\.0 \| 2026-10-02 \| 47 \| – \|/);
  assert.match(md, /41 stars/);
  assert.match(md, /Homebrew/);
});
