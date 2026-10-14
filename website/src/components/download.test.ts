import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// KB-02 / KB-14: every install path on the Download section works today.
// Release assets carry the version in their names, so a direct
// releases/latest/download/<name> link only works for the few files the
// release publishes under a fixed name.

const src = readFileSync(resolve(__dirname, "Download.astro"), "utf8");
const FIXED_NAME_ASSETS = new Set(["install-mac.sh"]);

describe("the Download section", () => {
  it("links straight to release files only when their names never change", () => {
    const direct = [...src.matchAll(/releases\/latest\/download\/([^"'\s<]+)/g)].map((m) => m[1]!);
    expect(direct.filter((name) => !FIXED_NAME_ASSETS.has(name))).toEqual([]);
  });

  it("offers no install command for a package or script that isn't published", () => {
    expect(src).not.toMatch(/winget install/);
    expect(src).not.toMatch(/install-linux\.sh/);
    expect(src).not.toMatch(/helm repo add/);
  });

  it("labels the Windows and Linux desktop apps Preview until they've had a hand-tested release", () => {
    expect(src).toMatch(/Windows\s*<span class="tabs__preview">Preview<\/span>/);
    expect(src).toMatch(/Linux\s*<span class="tabs__preview">Preview<\/span>/);
  });

  it("doesn't claim an ARM64 Linux desktop build", () => {
    const linux = src.slice(src.indexOf('id="tab-linux"'), src.indexOf('id="tab-helm"'));
    // The engine-only tarball comes for arm64; the desktop app doesn't.
    expect(linux).not.toMatch(/Architectures?:[^<]*ARM64/i);
    expect(linux).toMatch(/x86_64\. Preview/);
  });
});
