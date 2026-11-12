// A job that installs Playwright's Chromium with its system dependencies runs
// on an Ubuntu image that its pinned Playwright supports. On 2026-11-11
// `ubuntu-latest` became Ubuntu 26.04, and Playwright 1.56.1 stopped with
// "Playwright does not support chromium on ubuntu26.04-x64" before any test ran.
// Run: node --test scripts/playwright-runners.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobBlock } from "./workflow.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

// The first Playwright release that knows each Ubuntu image, read from the
// published playwright-core packages: "ubuntu24.04" first appears in 1.45.0
// (1.44.0 has none), "ubuntu26.04" in 1.61.0 (1.60.0 has none). 22.04 support
// is older than any Playwright this repo has pinned, so it has no floor here.
// `ubuntu-latest` is 26.04 since 2026-11-11.
const MIN_PLAYWRIGHT = { "ubuntu-22.04": "1.0.0", "ubuntu-24.04": "1.45.0", "ubuntu-26.04": "1.61.0" };
const IMAGE = { "ubuntu-latest": "ubuntu-26.04" };

const semver = (v) => v.replace(/^[^\d]*/, "").split(".").map(Number);
export const atLeast = (v, min) => {
  const [a, b] = [semver(v), semver(min)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};

// Every top-level job key in a workflow.
const jobNames = (yaml) => [...yaml.matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm)].map((m) => m[1]);

// The Playwright a job installs a browser with: perf/ uses playwright-core,
// e2e/ uses @playwright/test.
function playwrightFor(job) {
  if (/playwright-core install --with-deps/.test(job)) {
    return { pkg: "perf/package.json", version: JSON.parse(read("perf/package.json")).dependencies["playwright-core"] };
  }
  if (/playwright install --with-deps/.test(job)) {
    const p = JSON.parse(read("e2e/package.json"));
    return { pkg: "e2e/package.json", version: (p.devDependencies ?? {})["@playwright/test"] ?? (p.dependencies ?? {})["@playwright/test"] };
  }
  return null;
}

test("atLeast compares versions", () => {
  assert.ok(atLeast("1.61.0", "1.61.0"));
  assert.ok(atLeast("^1.65.0", "1.61.0"));
  assert.ok(!atLeast("1.56.1", "1.61.0"));
  assert.ok(!atLeast("1.60.9", "1.61.0"));
});

test("every job that installs Playwright's browser runs on an image its Playwright supports", () => {
  const ci = read(".github/workflows/ci.yml");
  const checked = [];
  const bad = [];
  for (const name of jobNames(ci.slice(ci.indexOf("\njobs:")))) {
    const job = jobBlock(ci, name);
    const pw = playwrightFor(job);
    if (!pw) continue;
    const runsOn = /^ {4}runs-on:\s*(\S+)/m.exec(job)?.[1] ?? "";
    const image = IMAGE[runsOn] ?? runsOn;
    const min = MIN_PLAYWRIGHT[image];
    checked.push(name);
    if (!min) bad.push(`${name}: runs-on ${runsOn} is not a known Ubuntu image`);
    else if (!atLeast(pw.version, min)) bad.push(`${name}: runs-on ${runsOn} (${image}) needs Playwright >= ${min}; ${pw.pkg} pins ${pw.version}`);
  }
  assert.deepEqual(checked.sort(), ["e2e", "e2e-dra", "perf"], "the jobs that install a Playwright browser");
  assert.deepEqual(bad, []);
});
