// Every engine binary CI tests or an image ships is built the way release
// binaries are: no cgo, stripped, stamped with a version, and compiled by
// go.mod's toolchain, with no build tags except the desktop app's engine, which
// carries the local shell (-tags localshell, as release.yml's sidecar does;
// scripts/local-shell-check.test.mjs checks that). perf/ci-contract.test.mjs
// checks the perf job.
// Run: node --test scripts/engine-builds.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobBlock, steps } from "./workflow.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

// The standalone engine, which the e2e jobs test, and the desktop app's engine,
// which the smoke job tests: the same flags, plus the tag on the desktop's.
const STANDALONE_BUILD = /go build -trimpath -ldflags "-s -w -X main\.version=/;
const DESKTOP_BUILD = /go build -trimpath -tags localshell -ldflags "-s -w -X main\.version=/;
const NO_CGO = /CGO_ENABLED(=|:\s*)"?0\b/;

for (const [name, build, forbidden] of [
  // make build adds the local shell (-tags localshell), which the standalone
  // engine releases ship never has.
  ["e2e", STANDALONE_BUILD, /-tags|make (web-install )?build\b|GOTOOLCHAIN/],
  ["e2e-dra", STANDALONE_BUILD, /-tags|make (web-install )?build\b|GOTOOLCHAIN/],
  ["desktop-smoke", DESKTOP_BUILD, /make (web-install )?build\b|GOTOOLCHAIN/],
]) {
  test(`the ${name} job tests the engine releases ship`, () => {
    const job = jobBlock(read(".github/workflows/ci.yml"), name);
    assert.notEqual(job, "", `ci.yml has a ${name} job`);
    assert.match(job, NO_CGO);
    assert.match(job, build);
    assert.doesNotMatch(job, forbidden);
  });
}

test("the image builds the engine like releases, with go.mod's toolchain", () => {
  const dockerfile = read("Dockerfile");
  const toolchain = read("engine/go.mod").match(/^toolchain go(\S+)$/m)?.[1];
  assert.ok(toolchain, "go.mod has a toolchain line");
  // A floating golang:1.26 tag is whatever patch release Docker Hub has now.
  assert.match(dockerfile, new RegExp(`^FROM golang:${toolchain.replaceAll(".", "\\.")}-alpine AS engine$`, "m"));
  assert.match(dockerfile, /^ARG VERSION=dev$/m);
  assert.match(dockerfile, NO_CGO);
  assert.match(dockerfile, /go build -trimpath -ldflags "-s -w -X main\.version=\$\{VERSION\}"/);
  assert.doesNotMatch(dockerfile, /-tags/);
});

test("the published image is stamped with the release tag", () => {
  const job = jobBlock(read(".github/workflows/publish.yml"), "image");
  const build = steps(job).find((s) => s.includes("docker/build-push-action"));
  assert.ok(build, "publish.yml builds the image");
  assert.match(build, /build-args:\s*VERSION=\$\{\{ github\.ref_type == 'tag' && github\.ref_name \|\|/);
});
