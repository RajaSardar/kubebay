// Security floors: versions below these have known vulnerabilities that the
// code reaches (govulncheck) or that ship in the app (pnpm audit). Raising a
// dependency past a floor is fine; dropping under one fails CI.
//
// Go 1.26.10 fixes crypto/x509 (GO-2026-6809); 1.26.11 fixes net/http's server
// crash (GO-2026-6859). go-tuf 2.4.1 fixes GO-2026-4377, -4349 and -4348.
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
