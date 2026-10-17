#!/usr/bin/env node
// KB-17 step 1: a monthly adoption report from public data only, so nothing
// in the app changes and nothing is sent from anyone's machine.
//
//   node scripts/download-report.mjs --repo OWNER/REPO [--previous previous.json] \
//     [--out download-report.json] [--summary "$GITHUB_STEP_SUMMARY"]
//
// It reads the repository's releases (each asset's download_count) and its
// star, fork and watcher counts. Download counts are cumulative, so the month's
// numbers come from the previous run's snapshot (--previous), which the
// workflow keeps as an artifact. Without one, the report has totals only.
//
// Homebrew: its public analytics cover only Homebrew's own taps, not
// rajasardar/tap. The tap's formula downloads the engine tarball from GitHub
// Releases, so brew installs are counted under "Engine, macOS (Homebrew)",
// together with direct downloads of that tarball.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const NOT_A_DOWNLOAD = /(\.sha256|\.sig|\.cosign\.bundle|\.intoto\.jsonl|\.json|^SHA256SUMS)$/i;

const CHANNELS = [
  [/\.dmg$|^kubebay-.*(macos|apple-darwin).*\.zip$/i, "macOS app"],
  [/\.(exe|msi)$/i, "Windows app"],
  [/\.(deb|rpm|AppImage)$/i, "Linux app"],
  [/^kubebay-airgap-.*\.tar\.gz$/i, "Air-gapped bundle"],
  [/^kubebay-darwin-.*\.tar\.gz$/i, "Engine, macOS (Homebrew)"],
  [/^kubebay-linux-.*\.tar\.gz$/i, "Engine, Linux"],
  [/^kubebay-windows-.*\.tar\.gz$/i, "Engine, Windows"],
  [/\.sh$/i, "Install script"],
];

/** The channel a release asset is a download of, or null for checksums, signatures, SBOMs and manifests. */
export function channel(name) {
  if (NOT_A_DOWNLOAD.test(name)) return null;
  for (const [re, label] of CHANNELS) if (re.test(name)) return label;
  return null;
}

/**
 * The parts of the API responses the report needs: published releases, their
 * downloadable assets, and the repository's counts.
 */
export function snapshot(releases, repo, date) {
  return {
    date,
    repo: {
      stars: repo.stargazers_count ?? 0,
      forks: repo.forks_count ?? 0,
      watchers: repo.subscribers_count ?? 0,
      openIssues: repo.open_issues_count ?? 0,
    },
    releases: releases
      .filter((r) => !r.draft && r.published_at)
      .map((r) => ({
        tag: r.tag_name,
        published: r.published_at,
        assets: r.assets
          .map((a) => ({ name: a.name, channel: channel(a.name), downloads: a.download_count ?? 0 }))
          .filter((a) => a.channel !== null),
      })),
  };
}

const sum = (xs) => xs.reduce((n, x) => n + x, 0);

/**
 * Totals all time, by channel (largest first) and by release (as the API lists
 * them, newest first). With a previous snapshot, each also gets what was
 * downloaded since: an asset the previous snapshot didn't have counts in full.
 */
export function report(current, previous) {
  const before = new Map();
  for (const r of previous?.releases ?? []) for (const a of r.assets) before.set(`${r.tag}/${a.name}`, a.downloads);
  const since = (tag, a) => (previous ? a.downloads - (before.get(`${tag}/${a.name}`) ?? 0) : null);
  const add = (n, d) => (n === null || d === null ? null : n + d);

  const channels = new Map();
  const byRelease = current.releases.map((r) => {
    let releaseSince = previous ? 0 : null;
    for (const a of r.assets) {
      const d = since(r.tag, a);
      releaseSince = add(releaseSince, d);
      const c = channels.get(a.channel) ?? { channel: a.channel, total: 0, sincePrevious: previous ? 0 : null };
      c.total += a.downloads;
      c.sincePrevious = add(c.sincePrevious, d);
      channels.set(a.channel, c);
    }
    return { tag: r.tag, published: r.published.slice(0, 10), total: sum(r.assets.map((a) => a.downloads)), sincePrevious: releaseSince };
  });

  return {
    date: current.date,
    previousDate: previous?.date ?? null,
    total: sum(byRelease.map((r) => r.total)),
    sincePrevious: previous ? sum(byRelease.map((r) => r.sincePrevious)) : null,
    byChannel: [...channels.values()].sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel)),
    byRelease,
    repo: previous
      ? { stars: current.repo.stars, starsSincePrevious: current.repo.stars - previous.repo.stars, forks: current.repo.forks, watchers: current.repo.watchers, openIssues: current.repo.openIssues }
      : current.repo,
  };
}

const cell = (n) => (n === null ? "–" : String(n));
const day = (iso) => (iso ? iso.slice(0, 10) : "");

/** The job summary: totals, then a table by channel and one by release. */
export function summaryMarkdown(r) {
  const since = r.previousDate ? `since ${day(r.previousDate)}` : "since the previous report";
  const lines = [
    `### Downloads (${day(r.date)})`,
    "",
    `${r.total} downloads of published releases, all time` + (r.sincePrevious === null ? ". No previous report to compare with yet." : `; ${r.sincePrevious} ${since}.`),
    "",
    `| Channel | All time | ${r.previousDate ? `Since ${day(r.previousDate)}` : "Since previous"} |`,
    "|---|---|---|",
    ...r.byChannel.map((c) => `| ${c.channel} | ${c.total} | ${cell(c.sincePrevious)} |`),
    "",
    `| Release | Published | All time | ${r.previousDate ? `Since ${day(r.previousDate)}` : "Since previous"} |`,
    "|---|---|---|---|",
    ...r.byRelease.map((x) => `| ${x.tag} | ${x.published} | ${x.total} | ${cell(x.sincePrevious)} |`),
    "",
    `${r.repo.stars} stars` +
      (r.repo.starsSincePrevious === undefined ? "" : ` (${r.repo.starsSincePrevious >= 0 ? "+" : ""}${r.repo.starsSincePrevious} ${since})`) +
      `, ${r.repo.forks} forks, ${r.repo.watchers} watchers, ${r.repo.openIssues} open issues and pull requests.`,
    "",
    "Homebrew installs download the engine tarball from GitHub Releases, so they're counted under " +
      '"Engine, macOS (Homebrew)", with direct downloads of it. Homebrew\'s own analytics cover only its core taps. ' +
      "Checksums, signatures and SBOMs aren't counted.",
    "",
  ];
  return lines.join("\n");
}

async function getJSON(url, token) {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
  return { body: await res.json(), next };
}

async function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repo = arg("--repo");
  if (!repo) throw new Error("--repo OWNER/REPO is required");
  const token = process.env.GITHUB_TOKEN;
  const api = `https://api.github.com/repos/${repo}`;

  const releases = [];
  for (let url = `${api}/releases?per_page=100`; url; ) {
    const page = await getJSON(url, token);
    releases.push(...page.body);
    url = page.next;
  }
  const { body: repoInfo } = await getJSON(api, token);

  const current = snapshot(releases, repoInfo, new Date().toISOString());
  const prevPath = arg("--previous");
  const previous = prevPath ? JSON.parse(readFileSync(prevPath, "utf8")) : undefined;
  const r = report(current, previous);
  const md = summaryMarkdown(r);
  console.log(md);
  if (arg("--out")) writeFileSync(arg("--out"), JSON.stringify(current, null, 2) + "\n");
  if (arg("--summary")) appendFileSync(arg("--summary"), md + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
