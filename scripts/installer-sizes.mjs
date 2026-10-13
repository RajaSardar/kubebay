#!/usr/bin/env node
// KB-02 step 1: weigh every installer a release produces against the
// previous release's and flag growth over a threshold (10%).
//
//   node scripts/installer-sizes.mjs --dir dist --tag v0.7.0 \
//     --previous previous.json [--threshold 0.1] [--out dist/installer-sizes.json] [--fail]
//
// previous.json is `gh api repos/OWNER/REPO/releases/latest` reduced to
// {tag, assets: [{name, size}]}, or {} for a first release. Growth is a
// warning until the budgets have three stable runs (KB-02 step 4); --fail
// turns it into a failure.

import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const INSTALLER = /\.(dmg|exe|msi|deb|rpm|AppImage|zip|tar\.gz)$/i;
const VERSION = /(?<=[_.-]v?)\d+\.\d+\.\d+(?:-(?:rc|alpha|beta|pre)[0-9A-Za-z.]*)?(?=[_.-])/g;

/** An installer or archive a user downloads, not a checksum, signature, SBOM or script. */
export function isInstaller(name) {
  return INSTALLER.test(name);
}

/** The asset's name with its version taken out, so releases line up. */
export function assetKey(name) {
  return name.replace(VERSION, "{version}");
}

/**
 * One row per installer in `current`, sorted by name: its size, the previous
 * release's size, the growth as a fraction, and "new", "ok" or "over".
 */
export function compareSizes(current, previous, threshold) {
  const before = new Map(previous.filter((a) => isInstaller(a.name)).map((a) => [assetKey(a.name), a]));
  return current
    .filter((a) => isInstaller(a.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => {
      const prev = before.get(assetKey(a.name));
      if (!prev) return { name: a.name, size: a.size, previousName: null, previousSize: null, growth: null, status: "new" };
      const growth = a.size / prev.size - 1;
      return { name: a.name, size: a.size, previousName: prev.name, previousSize: prev.size, growth, status: growth > threshold ? "over" : "ok" };
    });
}

const mib = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`;
const pct = (fraction) => `${(fraction * 100).toFixed(1)}%`;

/** GitHub workflow warning annotations for the installers over the threshold. */
export function warnings(rows, previousTag) {
  return rows
    .filter((r) => r.status === "over")
    .map((r) => `::warning title=Installer size::${r.name} is ${pct(r.growth)} larger than in ${previousTag} (${mib(r.previousSize)} → ${mib(r.size)})`);
}

/** A Markdown table for the job summary. */
export function summaryMarkdown(rows, { tag, previousTag, threshold }) {
  const lines = [
    `### Installer sizes, ${tag}`,
    "",
    `Compared with ${previousTag ?? "no earlier release"}.`,
    "",
    "| Installer | Size | Previous | Change |",
    "| --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    const change = r.status === "new" ? "new" : `${r.growth >= 0 ? "+" : ""}${pct(r.growth)}${r.status === "over" ? " ⚠️" : ""}`;
    lines.push(`| ${r.name} | ${mib(r.size)} | ${r.previousSize === null ? "–" : mib(r.previousSize)} | ${change} |`);
  }
  if (previousTag) {
    lines.push("", `⚠️ marks an installer more than ${Math.round(threshold * 100)}% larger than in ${previousTag}. It's a warning until the budgets have three stable runs (KB-02).`);
  }
  return lines.join("\n") + "\n";
}

function args(argv) {
  const out = { threshold: 0.1, fail: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fail") out.fail = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

function main() {
  const a = args(process.argv.slice(2));
  if (!a.dir || !a.tag) {
    console.error("usage: installer-sizes.mjs --dir DIR --tag TAG [--previous FILE] [--threshold 0.1] [--out FILE] [--fail]");
    process.exit(2);
  }
  const threshold = Number(a.threshold);
  const current = readdirSync(a.dir)
    .filter((name) => statSync(join(a.dir, name)).isFile())
    .map((name) => ({ name, size: statSync(join(a.dir, name)).size }));
  const prev = a.previous ? JSON.parse(readFileSync(a.previous, "utf8") || "{}") : {};
  const previousTag = typeof prev.tag === "string" ? prev.tag : null;
  const rows = compareSizes(current, Array.isArray(prev.assets) ? prev.assets : [], threshold);

  for (const line of warnings(rows, previousTag)) console.log(line);
  const md = summaryMarkdown(rows, { tag: a.tag, previousTag, threshold });
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  if (a.out) writeFileSync(a.out, JSON.stringify({ tag: a.tag, previousTag, threshold, installers: rows }, null, 2) + "\n");
  if (a.fail && rows.some((r) => r.status === "over")) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
