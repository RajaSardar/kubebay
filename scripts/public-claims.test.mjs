// KB-02: what the docs say about performance matches what CI does.
// Run: node --test scripts/public-claims.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const lines = (path) => read(path).split("\n").map((text, i) => ({ path, line: i + 1, text }));

const DOCS = ["README.md", "CONTRIBUTING.md", "docs/ARCHITECTURE.md", "docs/PRODUCT_REQUIREMENTS.md", "docs/PERFORMANCE.md"];
const SITE = readdirSync(join(root, "website/src/components"))
  .filter((f) => f.endsWith(".astro"))
  .map((f) => `website/src/components/${f}`);
const COMPETITOR = /\b(Lens|Freelens|Headlamp|k9s|Electron)\b/;
const where = (hits) => hits.map((h) => `${h.path}:${h.line}: ${h.text.trim()}`);

// The budgets step fails the job only when it's given --fail (KB-02 step 4).
export function budgetsFail(ciYaml) {
  const step = ciYaml.split("\n").find((l) => l.includes("scripts/perf-budgets.mjs"));
  return Boolean(step && /\s--fail\b/.test(step));
}

test("budgetsFail reads the flag off the budgets step", () => {
  assert.equal(budgetsFail("run: node scripts/perf-budgets.mjs --results p.json"), false);
  assert.equal(budgetsFail("run: node scripts/perf-budgets.mjs --results p.json --fail"), true);
  assert.equal(budgetsFail("run: echo nothing"), false);
});

test("the docs claim budget enforcement only once the perf job fails on a breach", () => {
  if (budgetsFail(read(".github/workflows/ci.yml"))) return;
  const hits = DOCS.flatMap(lines).filter(
    ({ text }) => /\benforced\b|\bfails? CI\b/i.test(text) && /budget|metric|perf/i.test(text),
  );
  assert.deepEqual(where(hits), []);
});

// A figure is a number with a unit, not the digit in "k9s" or "K8s".
const FIGURE = /(?<![A-Za-z])\d[\d.,–-]*\s?(MB|GB|s|ms)\b/;
export const sentences = (text) => text.split(/(?<=[.!?;])\s+/);

test("a figure is a number with a unit, and sentences split at their ends", () => {
  assert.equal(FIGURE.test("friendlier than k9s, built for K8s"), false);
  assert.equal(FIGURE.test("Electron's 200–400 MB"), true);
  assert.deepEqual(sentences("Not Electron. Installers are 19 MB."), ["Not Electron.", "Installers are 19 MB."]);
});

test("a competitor figure in the docs links its source", () => {
  const unsourced = DOCS.flatMap(lines).filter(
    ({ text }) => sentences(text).some((s) => COMPETITOR.test(s) && FIGURE.test(s) && !s.includes("](https://")),
  );
  assert.deepEqual(where(unsourced), []);
});

test("no table claims to know another tool's numbers", () => {
  const headers = DOCS.flatMap(lines).filter(({ text }) => text.trimStart().startsWith("|") && /\b(Lens|Freelens)\b.*\b(reality|measured)\b/i.test(text));
  assert.deepEqual(where(headers), []);
});

test("no comparative performance claim about a named tool", () => {
  const hits = [...DOCS, ...SITE]
    .flatMap(lines)
    .filter(({ text }) => /\b(lighter|faster|smaller|leaner|quicker)\s+than\s+(Lens|Freelens|Headlamp|k9s|Electron)\b/i.test(text));
  assert.deepEqual(where(hits), []);
});
