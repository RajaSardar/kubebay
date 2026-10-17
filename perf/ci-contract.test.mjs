// KB-02: the perf job measures the engine binary that releases ship.
// Run: node --test perf/ci-contract.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

// The lines of one top-level job in a workflow, by its key under `jobs:`.
export function jobBlock(yaml, name) {
  const all = yaml.split("\n");
  const start = all.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return "";
  const end = all.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  return all.slice(start, end < 0 ? undefined : end).join("\n");
}

test("jobBlock returns one job and stops at the next", () => {
  const yaml = "jobs:\n  a:\n    steps:\n      - run: x\n  # b runs later\n  b:\n    steps: []\n";
  assert.equal(jobBlock(yaml, "a"), "  a:\n    steps:\n      - run: x");
  assert.equal(jobBlock(yaml, "missing"), "");
});

test("releases build the engine without cgo or build tags", () => {
  const release = jobBlock(read(".github/workflows/release.yml"), "engine-binaries");
  assert.match(release, /CGO_ENABLED=0/);
  assert.match(release, /go build -trimpath -ldflags "-s -w -X main\.version=/);
  assert.doesNotMatch(release, /-tags/);
});

test("the perf job builds its engine the way releases do", () => {
  const perf = jobBlock(read(".github/workflows/ci.yml"), "perf");
  assert.notEqual(perf, "", "ci.yml has a perf job");
  assert.match(perf, /CGO_ENABLED=0/);
  assert.match(perf, /go build -trimpath -ldflags "-s -w -X main\.version=/);
  // make build adds the local shell (-tags localshell), which no release ships.
  assert.doesNotMatch(perf, /-tags|make (web-install )?build\b/);
});
