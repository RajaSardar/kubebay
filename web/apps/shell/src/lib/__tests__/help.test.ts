/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PAGE_HELP, docsUrl } from "../help";

// Root backlog #18 (docs/HELP_TIPS_RESEARCH.md): every page of the app has an
// ⓘ saying what it is and how it works, with a link to its page in the user
// manual (website/src/content/docs). A new page fails here until it has one.

const SRC = resolve(__dirname, "../..");
const DOCS = resolve(SRC, "../../../../website/src/content/docs");

// Routes that open another page's view rather than a page of their own.
const NO_HELP: Record<string, string> = {
  "/detail/:kind/:ns/:name": "a resource's own drawer, full page; its table has the help",
  "/view/:id": "opens a saved view's table, which has the help",
};

function appRoutes(): string[] {
  const app = readFileSync(join(SRC, "App.tsx"), "utf8");
  const out: string[] = [];
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([^}]*)\}/g)) {
    const [, path, element] = m;
    if (path === "*" || path!.endsWith("/*") || element!.includes("<Navigate")) continue;
    out.push(path!);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sourceFiles(p);
    return /\.tsx$/.test(name) ? [p] : [];
  });
}

/** The anchor Astro gives a Markdown heading (github-slugger, for plain text). */
function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>|`/g, "")
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/ /g, "-");
}

describe("docsUrl", () => {
  it("links a manual page, and a heading on it", () => {
    expect(docsUrl("helm")).toBe("https://kubebay.sardar.dev/docs/helm/");
    expect(docsUrl("pods#logs")).toBe("https://kubebay.sardar.dev/docs/pods/#logs");
  });
});

describe("page help", () => {
  it("covers every page of the app", () => {
    const missing = appRoutes().filter((r) => !(r in PAGE_HELP) && !(r in NO_HELP));
    expect(missing, "add the page to PAGE_HELP in src/lib/help.ts").toEqual([]);
  });

  it("is short: a sentence on what it is and one on how it works", () => {
    for (const [route, h] of Object.entries(PAGE_HELP)) {
      for (const text of [h.what, h.how]) {
        expect(text.length, `${route}: ${text}`).toBeLessThanOrEqual(170);
        expect(text, route).toMatch(/[.)]$/);
      }
    }
  });

  it("links to a page of the manual that exists, and a heading on it that exists", () => {
    for (const [route, h] of Object.entries(PAGE_HELP)) {
      const [slug, anchor] = h.docs.split("#");
      const file = join(DOCS, `${slug}.md`);
      expect(existsSync(file), `${route}: no website/src/content/docs/${slug}.md`).toBe(true);
      if (anchor) {
        const anchors = [...readFileSync(file, "utf8").matchAll(/^#{2,4} (.+)$/gm)].map((m) => headingSlug(m[1]!));
        expect(anchors, `${route}: no #${anchor} in ${slug}.md`).toContain(anchor);
      }
    }
  });

  it("is shown on its page", () => {
    const src = sourceFiles(SRC).map((f) => readFileSync(f, "utf8")).join("\n");
    const unshown = Object.keys(PAGE_HELP).filter((r) => !src.includes(`route="${r}"`));
    expect(unshown, 'render <PageHelp route="…" /> in the page header').toEqual([]);
  });
});
