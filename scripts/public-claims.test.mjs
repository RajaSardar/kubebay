// KB-02: what the docs and the site say about performance matches what CI
// does, and nothing quotes another tool's numbers without a source.
// Run: node --test scripts/public-claims.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { budgetsFail } from "./workflow.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

// The repo's public-facing docs. The research docs (BACKLOG, RESEARCH,
// COMPETITIVE_ANALYSIS) quote old claims to refute them, so they aren't here.
const DOCS = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/ARCHITECTURE.md",
  "docs/PRODUCT_REQUIREMENTS.md",
  "docs/PERFORMANCE.md",
  "docs/TECH_STACK.md",
  "docs/SECURITY.md",
  "docs/INSTALL.md",
  "docs/reddit-launch-post.md",
  "docs/cncf-landscape-submission.md",
];
const SITE = readdirSync(join(root, "website/src/components"))
  .filter((f) => f.endsWith(".astro"))
  .map((f) => `website/src/components/${f}`);

const COMPETITOR = /\b(Open)?(Lens|Freelens|Headlamp|k9s|Electron|Rancher)\b/;
// A figure is a number with a unit, not the digit in "k9s" or "K8s".
export const FIGURE = /(?<![A-Za-z])\d[\d.,–-]*\+?\s?(MB|MiB|GB|GiB|KB|KiB|ms|s|secs?|seconds?|min|minutes?)\b/i;
const ENFORCES = /\benforc(e|es|ed|ing|ement)\b|\bfail(s|ing)?\s+(the\s+|a\s+)?(CI|build|PR|job|merge)\b|\bCI\s+(fails|blocks|gates)\b|\bblocks?\s+(the\s+)?merge\b/i;
const ABOUT_PERF = /\bbudgets?\b|\bperformance\b|\bperf\b|\bmetrics?\b(?!-server)/i;
export const claimsEnforcement = (text) => ENFORCES.test(text) && ABOUT_PERF.test(text);
export const comparesSpeed = (text) =>
  /\b(lighter|faster|smaller|leaner|quicker|snappier)(-weight)?\s+than\s+(\w+\s+){0,3}(Open)?(Lens|Freelens|Headlamp|k9s|Electron)\b/i.test(text);
export const disparages = (text) => /\bbloat(ed)?\b|\bunmaintained\b|\bElectron[- ]heavy\b/i.test(text);
export const sentences = (text) => text.split(/(?<=[.!?;])\s+/);

// Prose as paragraphs (a hard-wrapped claim is one unit), list items and
// headings on their own, table rows and fenced code left out. Each unit keeps
// the line it starts on.
export function prose(path, text) {
  const out = [];
  let cur = null;
  let fenced = false;
  text.split("\n").forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith("```")) { fenced = !fenced; cur = null; return; }
    if (fenced || t === "" || t.startsWith("|")) { cur = null; return; }
    if (!cur || /^(#|[-*+] |\d+\. |>)/.test(t)) { cur = { path, line: i + 1, text: t }; out.push(cur); }
    else cur.text += " " + t;
  });
  return out;
}

// Markdown tables as {path, line, header: [cells], rows: [{line, cells}]}.
export function tables(path, text) {
  const out = [];
  let cur = null;
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  text.split("\n").forEach((l, i) => {
    if (!l.trim().startsWith("|")) { cur = null; return; }
    if (!cur) { cur = { path, line: i + 1, header: cells(l), rows: [] }; out.push(cur); return; }
    if (/^\|[\s|:-]+\|?$/.test(l.trim())) return; // the |---|---| rule
    cur.rows.push({ line: i + 1, cells: cells(l) });
  });
  return out;
}

const where = (hits) => hits.map((h) => `${h.path}:${h.line}: ${h.text.slice(0, 160)}`);
const docProse = () => DOCS.flatMap((p) => prose(p, read(p)));

test("budgetsFail reads the perf job's Budgets step", () => {
  const ci = (run, extra = "") =>
    `jobs:\n  perf:\n    steps:\n      - name: Budgets\n${extra}        run: ${run}\n      - uses: actions/upload-artifact@v4\n`;
  assert.equal(budgetsFail(ci("node scripts/perf-budgets.mjs --results p.json")), false);
  assert.equal(budgetsFail(ci("node scripts/perf-budgets.mjs --results p.json --fail")), true);
  assert.equal(budgetsFail(ci("|\n          node scripts/perf-budgets.mjs --results p.json \\\n            --fail")), true, "a flag on a continuation line");
  assert.equal(budgetsFail(ci("node scripts/perf-budgets.mjs --results p.json # add --fail later")), false, "a comment");
  assert.equal(budgetsFail(ci("node scripts/perf-budgets.mjs --fail=false")), false, "not the exact token");
  assert.equal(budgetsFail(ci("node scripts/perf-budgets.mjs --fail", "        continue-on-error: true\n")), false);
  assert.equal(budgetsFail(ci("node scripts/perf-budgets.mjs --fail || true")), false);
  assert.equal(budgetsFail("jobs:\n  other:\n    steps:\n      - run: node scripts/perf-budgets.mjs --fail\n"), false, "only the perf job counts");
});

test("the guards' predicates catch rephrasings and leave unrelated text alone", () => {
  for (const t of ["Budgets are enforced by CI.", "CI enforces the performance budgets.", "A PR over budget fails the build.",
    "CI fails any PR that regresses a budget.", "Budget enforcement runs in CI.", "any PR that moves a red metric fails CI"]) {
    assert.ok(claimsEnforcement(t), t);
  }
  assert.ok(!claimsEnforcement("RBAC is enforced by the API server; metrics-server is optional."));
  for (const t of ["lighter than Freelens", "lighter than both Lens and Freelens", "much faster than any Electron app",
    "lighter-weight than Freelens", "faster than OpenLens"]) {
    assert.ok(comparesSpeed(t), t);
  }
  for (const t of ["Lens idles at 500+ MB.", "Freelens takes 8-15 seconds", "400MiB", "3 sec", "Electron's 200–400 MB"]) {
    assert.ok(FIGURE.test(t), t);
  }
  assert.ok(!FIGURE.test("friendlier than k9s, built for K8s"));
  assert.deepEqual(sentences("Not Electron. Installers are 19 MB."), ["Not Electron.", "Installers are 19 MB."]);
  assert.equal(prose("x", "Freelens idles at\n400 MB.\n\n- a list item")[0].text, "Freelens idles at 400 MB.");
});

test("the docs claim budget enforcement only once the perf job fails on a breach", (t) => {
  if (budgetsFail(read(".github/workflows/ci.yml"))) return t.skip("the Budgets step passes --fail");
  assert.deepEqual(where(docProse().filter((u) => claimsEnforcement(u.text))), []);
});

test("a competitor figure in the docs links its source", () => {
  const unsourced = docProse().filter((u) =>
    sentences(u.text).some((s) => COMPETITOR.test(s) && FIGURE.test(s) && !s.includes("](https://")),
  );
  assert.deepEqual(where(unsourced), []);
});

test("no table carries another tool's numbers without a source", () => {
  const fixture = tables("fixture", "| Metric | Budget | Freelens/Lens (public reports) |\n|---|---|---|\n| Idle RSS | ≤ 150 MB | ~300–500 MB common |\n");
  const hits = (ts) =>
    ts.flatMap((tbl) => {
      const cols = tbl.header.map((h, i) => (COMPETITOR.test(h) ? i : -1)).filter((i) => i >= 0);
      return tbl.rows
        .filter((r) => cols.some((c) => FIGURE.test(r.cells[c] ?? "") && !(r.cells[c] ?? "").includes("](https://")))
        .map((r) => ({ path: tbl.path, line: r.line, text: r.cells.join(" | ") }));
    });
  assert.equal(hits(fixture).length, 1, "the fixture's competitor column is caught");
  assert.deepEqual(where(hits(DOCS.flatMap((p) => tables(p, read(p))))), []);
});

test("no comparative or disparaging claim about a named tool", () => {
  const units = [...docProse(), ...SITE.flatMap((p) => read(p).split("\n").map((text, i) => ({ path: p, line: i + 1, text })))];
  assert.deepEqual(where(units.filter((u) => comparesSpeed(u.text) || disparages(u.text))), []);
});
