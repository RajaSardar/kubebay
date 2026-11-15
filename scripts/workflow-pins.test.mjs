// Supply-chain guards for .github/workflows.
//
// An action pinned to a tag (`@v4`) or a branch (`@stable`) runs whatever that
// tag or branch points at today. If its owner's account is compromised the
// attacker moves the tag and our next run executes their code, with the
// release workflow's signing keys and id-token in reach. A full commit SHA can't
// be moved. Dependabot keeps the pins from going stale.
//
// Run: node --test scripts/workflow-pins.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".github/workflows");
const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));

const uses = files.flatMap((f) =>
  readFileSync(join(dir, f), "utf8")
    .split("\n")
    .map((line, i) => ({ f, n: i + 1, m: line.match(/^\s*-?\s*uses:\s*(\S+)/) }))
    .filter((x) => x.m)
    .map((x) => ({ f: x.f, n: x.n, ref: x.m[1] })),
);

test("finds the workflows' actions", () => assert.ok(uses.length > 40, `only ${uses.length} uses: lines`));

test("every action is pinned to a full commit SHA", () => {
  const loose = uses
    .filter((u) => !u.ref.startsWith("./") && !u.ref.startsWith("docker://"))
    .filter((u) => !/@[0-9a-f]{40}$/.test(u.ref))
    .map((u) => `${u.f}:${u.n} ${u.ref}`);
  assert.deepEqual(loose, []);
});

test("a pinned action says which release the SHA is, so the pin can be reviewed", () => {
  const bare = files.flatMap((f) =>
    readFileSync(join(dir, f), "utf8")
      .split("\n")
      .map((line, i) => ({ f, n: i + 1, line }))
      .filter(({ line }) => /uses:\s*\S+@[0-9a-f]{40}\s*$/.test(line))
      .map(({ f, n }) => `${f}:${n}`),
  );
  assert.deepEqual(bare, [], "add a trailing `# vX.Y.Z` comment to these");
});

test("ci.yml declares the least token permission it needs", () => {
  const ci = readFileSync(join(dir, "ci.yml"), "utf8");
  assert.match(ci, /^permissions:\s*\n\s+contents:\s*read\s*$/m, "ci.yml has no top-level `permissions: contents: read`");
});

test("dependabot keeps the action pins current", () => {
  const p = join(root, ".github/dependabot.yml");
  assert.ok(existsSync(p), ".github/dependabot.yml is missing");
  const y = readFileSync(p, "utf8");
  assert.match(y, /package-ecosystem:\s*["']?github-actions["']?/);
  assert.match(y, /directory:\s*["']?\/["']?/);
});
