// Security floors: versions below these have known vulnerabilities that the
// code reaches (govulncheck) or that ship in the app (pnpm audit). Raising a
// dependency past a floor is fine; dropping under one fails CI.
//
// Go 1.26.10 fixes crypto/x509 (GO-2026-6809); 1.26.11 fixes net/http's server
// crash (GO-2026-6859). go-tuf 2.4.1 fixes GO-2026-4377, -4349 and -4348.
// DOMPurify 3.4.17 fixes the SAFE_FOR_TEMPLATES and IN_PLACE bypasses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const ver = (s) => s.split(".").map((n) => parseInt(n, 10));
const atLeast = (have, floor) => {
  const a = ver(have), b = ver(floor);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
};

test("the Go toolchain is past the net/http and crypto/x509 fixes", () => {
  const m = read("engine/go.mod").match(/^toolchain go(\d+\.\d+\.\d+)$/m);
  assert.ok(m, "engine/go.mod names a toolchain");
  assert.ok(atLeast(m[1], "1.26.11"), `toolchain go${m[1]} is below go1.26.11`);
});

test("the container image builds with the same Go the module pins", () => {
  const tool = read("engine/go.mod").match(/^toolchain go(\d+\.\d+\.\d+)$/m)[1];
  const img = read("Dockerfile").match(/^FROM golang:(\d+\.\d+\.\d+)/m);
  assert.ok(img, "Dockerfile has a golang build stage");
  assert.equal(img[1], tool);
});

test("go-tuf is past its path-traversal, threshold and DoS fixes", () => {
  const m = read("engine/go.mod").match(/github\.com\/theupdateframework\/go-tuf\/v2 v(\d+\.\d+\.\d+)/);
  assert.ok(m, "go-tuf is required");
  assert.ok(atLeast(m[1], "2.4.1"), `go-tuf v${m[1]} is below v2.4.1`);
});

test("every DOMPurify the web app resolves is past the template and IN_PLACE bypasses", () => {
  const lock = read("web/pnpm-lock.yaml");
  const found = [...lock.matchAll(/^\s+dompurify@(\d+\.\d+\.\d+):/gm)].map((m) => m[1]);
  assert.ok(found.length > 0, "dompurify is in the lockfile");
  for (const v of found) assert.ok(atLeast(v, "3.4.17"), `dompurify@${v} is below 3.4.17`);
});

test("the website uses an Astro past its advisories, and CI runs it on a Node it supports", () => {
  const lock = JSON.parse(read("website/package-lock.json"));
  const astro = lock.packages["node_modules/astro"];
  assert.ok(astro, "astro is in the website lockfile");
  // 7.3.8 fixes the X-Forwarded-Host reflection and URL manipulation advisories
  // and carries patched vite, sharp and zod.
  assert.ok(atLeast(astro.version, "7.3.8"), `astro ${astro.version} is below 7.3.8`);

  const need = (astro.engines?.node ?? "").match(/>=(\d+)\.(\d+)/);
  assert.ok(need, "astro declares a minimum Node");
  const nodeVersions = [
    ...read(".github/workflows/deploy-website.yml").matchAll(/node-version:\s*"?(\d+)(?:\.(\d+))?/g),
  ].map((m) => [Number(m[1]), Number(m[2] ?? 0)]);
  // the website job in ci.yml sets up Node under its own name
  const ci = read(".github/workflows/ci.yml");
  const job = ci.slice(ci.indexOf("  website:"));
  nodeVersions.push(...[...job.slice(0, job.indexOf("\n  scripts:") > 0 ? job.indexOf("\n  scripts:") : undefined).matchAll(/node-version:\s*"?(\d+)(?:\.(\d+))?/g)].map((m) => [Number(m[1]), Number(m[2] ?? 0)]));
  assert.ok(nodeVersions.length >= 2, "both website workflows set a Node version");
  for (const [maj, min] of nodeVersions) {
    assert.ok(maj > Number(need[1]) || (maj === Number(need[1]) && min >= Number(need[2])), `Node ${maj}.${min} is below astro's ${need[1]}.${need[2]}`);
  }
});
