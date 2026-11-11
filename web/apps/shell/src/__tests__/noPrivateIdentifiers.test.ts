/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// This repository is public. Nothing in it may name the maintainer's employer,
// a real AWS account, or a workload copied from a real cluster. Fixtures use
// the documentation account 111122223333 and made-up names.
//
// The forbidden words are built from parts so this file doesn't contain what
// it forbids.

const root = resolve(__dirname, "../../../../..");
const self = "web/apps/shell/src/__tests__/noPrivateIdentifiers.test.ts";
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|gz|zip|wasm|pdf)$/i;

const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "an employer's name", re: new RegExp(["intan", "gles"].join(""), "i") },
  { name: "a copied cluster workload name", re: new RegExp(["debugging-apis", "fml", "in"].join("-"), "i") },
  { name: "a copied cluster namespace", re: new RegExp(["platform", "consumers"].join("-"), "i") },
];

// arn:aws:<service>:<region>:<12-digit account>: only the documentation accounts.
const ARN_ACCOUNT = /arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:(\d{12}):/g;
const DOC_ACCOUNTS = new Set(["111122223333", "123456789012"]);

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  .toString("utf8")
  .split("\0")
  .filter((f) => f && f !== self && !SKIP_EXT.test(f));

function text(file: string): string | null {
  try {
    const p = resolve(root, file);
    return statSync(p).size > 2_000_000 ? null : readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

describe("the public repository names nothing private", () => {
  it("scans the tracked files", () => expect(tracked.length).toBeGreaterThan(100));

  for (const { name, re } of FORBIDDEN) {
    it(`has no ${name}`, () => {
      const hits = tracked.filter((f) => re.test(text(f) ?? ""));
      expect(hits).toEqual([]);
    });
  }

  it("uses only documentation AWS account ids in ARNs", () => {
    const hits = tracked.flatMap((f) =>
      [...(text(f) ?? "").matchAll(ARN_ACCOUNT)].filter((m) => !DOC_ACCOUNTS.has(m[1]!)).map((m) => `${f}: ${m[1]}`),
    );
    expect(hits).toEqual([]);
  });
});
