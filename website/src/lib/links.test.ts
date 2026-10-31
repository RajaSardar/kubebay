import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Every GitHub URL the site links to is this repository, and every file it
// points at on main is in the repository. A button to a repo that isn't ours,
// or a file that isn't there, is a 404 the visitor finds first.

const SRC = resolve(__dirname, "..");
const REPO_ROOT = resolve(__dirname, "../../..");
const REPO = "RajaSardar/kubebay";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(astro|ts|md|mdx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

// The comparison data and the docs cite other projects on purpose; the site's own pages do not.
const SITE = ["components", "pages", "layouts"].flatMap((d) => (existsSync(join(SRC, d)) ? files(join(SRC, d)) : []));

const urls = SITE.flatMap((f) =>
  [...readFileSync(f, "utf8").matchAll(/https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)([^\s"'`)<>]*)/g)].map((m) => ({
    file: f.replace(SRC, "src"),
    repo: m[1]!,
    path: m[2]!,
  })),
);

describe("GitHub links on the site", () => {
  it("finds some", () => expect(urls.length).toBeGreaterThan(0));

  it("all point at this repository", () => {
    expect(urls.filter((u) => u.repo !== REPO).map((u) => `${u.file}: ${u.repo}`)).toEqual([]);
  });

  it("only name files on main that exist", () => {
    const missing = urls
      .filter((u) => u.repo === REPO)
      .map((u) => ({ ...u, m: u.path.match(/^\/(?:blob|tree)\/main\/([^#?]+)/) }))
      .filter((u) => u.m && !existsSync(join(REPO_ROOT, u.m[1]!)))
      .map((u) => `${u.file}: ${u.m![1]}`);
    expect(missing).toEqual([]);
  });
});
