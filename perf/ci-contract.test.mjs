// KB-02: the perf job measures the engine binary that releases ship.
// Run: node --test perf/ci-contract.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobBlock } from "../scripts/workflow.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

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
  // GOTOOLCHAIN unset: go.mod's toolchain line picks the compiler.
  assert.doesNotMatch(release, /GOTOOLCHAIN/);
});

test("the perf job builds its engine the way releases do", () => {
  const perf = jobBlock(read(".github/workflows/ci.yml"), "perf");
  assert.notEqual(perf, "", "ci.yml has a perf job");
  assert.match(perf, /CGO_ENABLED=0/);
  assert.match(perf, /go build -trimpath -ldflags "-s -w -X main\.version=/);
  // make build adds the local shell (-tags localshell), which no release ships.
  assert.doesNotMatch(perf, /-tags|make (web-install )?build\b/);
  // The same compiler as releases: go.mod's toolchain line, not the Go that
  // setup-go installs (GOTOOLCHAIN=local, as the Makefile sets, would use that).
  assert.doesNotMatch(perf, /GOTOOLCHAIN/);
});
