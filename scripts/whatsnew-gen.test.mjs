// The "What's new" window reads web/apps/shell/src/generated/whatsnew.json, which is parsed
// from CHANGELOG.md. The parser has to cope with the changelog as it is really written
// (nested bullets, text over several lines, items with no bold lead), the committed JSON
// has to match the changelog, and a version bump has to come with a changelog section.
// Run: node --test scripts/whatsnew-gen.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelog, renderJson } from "./whatsnew-gen.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

const fixture = `# Changelog

## [Unreleased]

### Added
- **Pod logs in colour**: the Logs tab colours each line by its level. Errors are red:
  - JSON levels;
  - logfmt levels.

  Lines with no level are coloured too.
- **Tables have no lines.** Rows are told apart by the hover tint, and \`--kb-x\` stays.
- Plain item with no bold lead. It has a second sentence.
- **Multi-line [link](https://example.com) title**: spreads over
  two lines with <kbd>Ctrl</kbd> and **bold** and e.g. an abbreviation. Then more.

### Fixed
- **A fix**: it works now.

## [0.7.2] - 2026-11-14

### Added
- **Signing key**: releases carry it.

## [0.1.3] — 2026-09-09

### Changed
- **Old**: thing.

### Security
`;

test("parses releases, dates, sections and items", () => {
  const { releases } = parseChangelog(fixture);
  assert.deepEqual(
    releases.map((r) => [r.version, r.date]),
    [["unreleased", ""], ["0.7.2", "2026-11-14"], ["0.1.3", "2026-09-09"]],
  );
  assert.deepEqual(releases[0].sections.map((s) => s.heading), ["Added", "Fixed"]);
  assert.deepEqual(releases[2].sections.map((s) => s.heading), ["Changed"], "an empty section is dropped");
});

test("the title is the bold lead, the summary the first sentence of the rest as plain text", () => {
  const items = parseChangelog(fixture).releases[0].sections[0].items;
  assert.deepEqual(items[0], { title: "Pod logs in colour", summary: "The Logs tab colours each line by its level." });
  assert.deepEqual(items[1], { title: "Tables have no lines", summary: "Rows are told apart by the hover tint, and --kb-x stays." });
});

test("nested bullets and continuation paragraphs do not become items or leak into the summary", () => {
  const items = parseChangelog(fixture).releases[0].sections[0].items;
  assert.equal(items.length, 4);
  assert.ok(!items.some((i) => /JSON levels|coloured too/.test(i.title + i.summary)));
});

test("an item with no bold lead uses its first sentence as the title", () => {
  const items = parseChangelog(fixture).releases[0].sections[0].items;
  assert.deepEqual(items[2], { title: "Plain item with no bold lead", summary: "" });
});

test("multi-line text is joined, markdown is stripped, abbreviations do not end a sentence", () => {
  const items = parseChangelog(fixture).releases[0].sections[0].items;
  assert.equal(items[3].title, "Multi-line link title");
  assert.equal(items[3].summary, "Spreads over two lines with Ctrl and bold and e.g. an abbreviation.");
});

test("a very long first sentence is cut at a word", () => {
  const long = `## [1.0.0] - 2026-01-01\n\n### Fixed\n- **T**: ${"word ".repeat(100)}end.\n`;
  const s = parseChangelog(long).releases[0].sections[0].items[0].summary;
  assert.ok(s.length <= 241 && s.endsWith("…"), s);
});

test("the real CHANGELOG parses: every released version has an item, every item a title", () => {
  const { releases } = parseChangelog(changelog);
  assert.equal(releases[0].version, "unreleased");
  assert.ok(releases.length >= 4);
  for (const r of releases) {
    if (r.version !== "unreleased") {
      assert.ok(r.sections.some((s) => s.items.length > 0), `${r.version} has no items`);
    }
    for (const s of r.sections) {
      for (const i of s.items) {
        assert.ok(i.title.length > 0, `${r.version}/${s.heading} has an item with no title`);
        assert.ok(!/\*\*|\[[^\]]*\]\(/.test(i.title + i.summary), `markdown left in "${i.title}" / "${i.summary}"`);
      }
    }
  }
});

test("the committed whatsnew.json matches CHANGELOG.md (run: node scripts/whatsnew-gen.mjs)", () => {
  const committed = readFileSync(join(root, "web/apps/shell/src/generated/whatsnew.json"), "utf8");
  assert.equal(committed, renderJson(parseChangelog(changelog)));
});

test("the shell's prebuild and predev regenerate it, so a build always matches", () => {
  const pkg = JSON.parse(readFileSync(join(root, "web/apps/shell/package.json"), "utf8"));
  for (const k of ["prebuild", "predev"]) assert.match(pkg.scripts[k], /whatsnew-gen\.mjs/);
});

test("the desktop version in tauri.conf.json has a CHANGELOG section, or notes waiting under Unreleased", () => {
  const { version } = JSON.parse(readFileSync(join(root, "desktop/src-tauri/tauri.conf.json"), "utf8"));
  const { releases } = parseChangelog(changelog);
  const has = releases.some((r) => r.version === version);
  const pending = releases[0].version === "unreleased" && releases[0].sections.some((s) => s.items.length > 0);
  assert.ok(has || pending, `tauri.conf.json is ${version} but CHANGELOG.md has no "## [${version}]" section and nothing under Unreleased`);
});
