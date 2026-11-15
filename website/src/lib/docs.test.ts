import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SECTIONS, docLinks, parseFrontmatter, shellRoutes, sidebar, sitemapXml } from "./docs";

// Root BACKLOG #17: the usage manual lives at kubebay.sardar.dev/docs, and
// every change that adds or changes a feature updates it. These guards make
// a page of the app without a docs page, or a docs link to nowhere, fail CI.

describe("parseFrontmatter", () => {
  it("reads strings, quoted strings, numbers and JSON arrays", () => {
    const md = `---\ntitle: "Helm: releases and charts"\ndescription: Install, upgrade and roll back.\norder: 3\nappRoutes: ["/helm", "/r/:kind"]\n---\n\n# Body`;
    expect(parseFrontmatter(md)).toEqual({
      title: "Helm: releases and charts",
      description: "Install, upgrade and roll back.",
      order: 3,
      appRoutes: ["/helm", "/r/:kind"],
    });
  });

  it("is empty without a frontmatter block", () => {
    expect(parseFrontmatter("# Just a heading")).toEqual({});
  });
});

describe("shellRoutes", () => {
  it("lists the app's pages, leaving out redirects and the catch-all", () => {
    const app = `
      <Route path="/" element={<Navigate to="/workloads-overview" replace />} />
      <Route path="/workloads" element={<Workloads />} />
      <Route path="/r/:kind" element={<ResourceTable />} />
      <Route path="/fleet" element={<Navigate to="/clusters" replace />} />
      <Route path="*" element={<NotFound />} />
      <Route path="/clusters" element={<ClusterPicker />} />
      <Route path="/*" element={<AppInner />} />`;
    expect(shellRoutes(app)).toEqual(["/workloads", "/r/:kind", "/clusters"]);
  });
});

describe("sidebar", () => {
  it("groups pages by section, in the sections' order, then each page's order", () => {
    const docs = [
      { slug: "helm", title: "Helm", section: "Tools", order: 2 },
      { slug: "install", title: "Install", section: "Getting started", order: 2 },
      { slug: "terminal", title: "Terminal", section: "Tools", order: 1 },
      { slug: "intro", title: "Introduction", section: "Getting started", order: 1 },
    ];
    expect(sidebar(docs).map((g) => [g.section, g.items.map((i) => i.slug)])).toEqual([
      ["Getting started", ["intro", "install"]],
      ["Tools", ["terminal", "helm"]],
    ]);
  });
});

describe("docLinks", () => {
  it("finds the docs pages a page links to, without anchors", () => {
    const md = "See [Helm](/docs/helm/) and [logs](/docs/pods/#logs), not [GitHub](https://github.com) or [home](/).";
    expect(docLinks(md)).toEqual(["helm", "pods"]);
  });
});

describe("sitemapXml", () => {
  it("lists every page under the site's origin", () => {
    const xml = sitemapXml("https://kubebay.sardar.dev", ["/", "/docs/", "/docs/helm/"]);
    expect(xml).toContain("<loc>https://kubebay.sardar.dev/</loc>");
    expect(xml).toContain("<loc>https://kubebay.sardar.dev/docs/helm/</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(3);
  });
});

describe("the docs", () => {
  const dir = resolve(__dirname, "../content/docs");
  const docs = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const md = readFileSync(resolve(dir, f), "utf8");
      return { slug: f.replace(/\.md$/, ""), md, fm: parseFrontmatter(md) };
    });
  const slugs = new Set(docs.map((d) => d.slug));

  it("documents every page of the app", () => {
    const app = readFileSync(resolve(__dirname, "../../../web/apps/shell/src/App.tsx"), "utf8");
    const documented = new Set(docs.flatMap((d) => (d.fm.appRoutes as string[] | undefined) ?? []));
    const missing = shellRoutes(app).filter((r) => !documented.has(r));
    expect(missing, "add the page to a doc's appRoutes in website/src/content/docs").toEqual([]);
  });

  it("gives every page a title, a description and a known section", () => {
    for (const { slug, fm } of docs) {
      expect(fm.title, slug).toEqual(expect.any(String));
      expect(fm.description, slug).toEqual(expect.any(String));
      expect(SECTIONS, slug).toContain(fm.section);
      expect(fm.order, slug).toEqual(expect.any(Number));
    }
  });

  it("quotes a frontmatter value that YAML would misread", () => {
    // Astro reads frontmatter as YAML: an unquoted ": " or " #" breaks the build.
    const unquoted = docs.flatMap(({ slug, md }) =>
      (/^---\r?\n([\s\S]*?)\r?\n---/.exec(md)?.[1] ?? "")
        .split(/\r?\n/)
        .filter((line) => /^\w+: [^"[\d]/.test(line) && /: .*(: | #)/.test(line))
        .map((line) => `${slug}: ${line}`),
    );
    expect(unquoted).toEqual([]);
  });

  it("links only to docs pages that exist", () => {
    const broken = docs.flatMap((d) => docLinks(d.md).filter((s) => !slugs.has(s)).map((s) => `${d.slug} → ${s}`));
    expect(broken).toEqual([]);
  });

  it("has an introduction", () => {
    expect(slugs).toContain("index");
  });
});
