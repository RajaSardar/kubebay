#!/usr/bin/env node
// Turns CHANGELOG.md (Keep a Changelog) into the JSON the "What's new" window reads:
//   { releases: [{ version, date, sections: [{ heading, items: [{ title, summary }] }] }] }
// `## [Unreleased]` is included with version "unreleased". Run it from anywhere:
//   node scripts/whatsnew-gen.mjs
// The shell's prebuild/predev run it, so a build always matches the changelog.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_SUMMARY = 240;
const ABBREVIATIONS = /(?:\be\.g|\bi\.e|\bvs|\betc|\bcf)$/i;

/** Markdown to plain text: code spans, bold, italics, links and inline HTML lose their markup. */
export function stripMarkdown(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** The text up to the first sentence end (a . ! ? before a space or the end), without it. */
export function firstSentence(text) {
  const re = /[.!?](?=\s|$)/g;
  let m;
  while ((m = re.exec(text))) {
    if (ABBREVIATIONS.test(text.slice(0, m.index))) continue;
    return text.slice(0, m.index + 1);
  }
  return text;
}

function tidy(sentence) {
  let s = sentence.trim().replace(/[:;,]$/, "");
  if (s.length > MAX_SUMMARY) {
    s = s.slice(0, MAX_SUMMARY + 1);
    s = s.slice(0, Math.max(s.lastIndexOf(" "), 1)).replace(/[\s.,;:]+$/, "") + "…";
  }
  return s;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** One bullet's first paragraph, joined onto one line, to { title, summary }. */
export function parseItem(raw) {
  const bold = raw.match(/^\*\*(.+?)\*\*(.*)$/s);
  if (bold) {
    const title = stripMarkdown(bold[1]).replace(/[.:]+$/, "");
    const rest = stripMarkdown(bold[2].replace(/^[\s:.—-]+/, ""));
    return { title, summary: rest ? cap(tidy(firstSentence(rest))) : "" };
  }
  const plain = stripMarkdown(raw);
  return { title: tidy(firstSentence(plain)).replace(/\.$/, ""), summary: "" };
}

export function parseChangelog(md) {
  const releases = [];
  let release = null;
  let section = null;
  let item = null; // { lines: [], open: bool }
  const flush = () => {
    if (item && section) {
      const text = item.lines.join(" ").trim();
      if (text) section.items.push(parseItem(text));
    }
    item = null;
  };
  for (const line of md.split(/\r?\n/)) {
    const rel = line.match(/^## \[([^\]]+)\]\s*(?:[—–-]\s*(\S.*))?$/);
    if (rel) {
      flush();
      const v = rel[1].trim();
      release = { version: /^unreleased$/i.test(v) ? "unreleased" : v.replace(/^v/, ""), date: (rel[2] ?? "").trim(), sections: [] };
      releases.push(release);
      section = null;
      continue;
    }
    if (!release) continue;
    const sec = line.match(/^### (.+?)\s*$/);
    if (sec) {
      flush();
      section = { heading: sec[1], items: [] };
      release.sections.push(section);
      continue;
    }
    if (/^## /.test(line)) {
      flush();
      section = null;
      continue;
    }
    if (/^- /.test(line)) {
      flush();
      item = { lines: [line.slice(2).trim()], open: true };
      continue;
    }
    if (!item) continue;
    // Only the first paragraph feeds the summary: a blank line or a nested bullet closes it.
    if (line.trim() === "" || /^\s+[-*] /.test(line)) item.open = false;
    else if (item.open) item.lines.push(line.trim());
  }
  flush();
  for (const r of releases) r.sections = r.sections.filter((s) => s.items.length > 0);
  return { releases };
}

export const renderJson = (data) => JSON.stringify(data, null, 2) + "\n";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(root, "web/apps/shell/src/generated/whatsnew.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderJson(parseChangelog(readFileSync(join(root, "CHANGELOG.md"), "utf8"))));
}
