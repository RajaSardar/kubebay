// The docs at /docs: their sidebar, their sitemap entries, and the checks
// docs.test.ts runs over them. Pure, so the tests and the pages share them.

/** The sidebar's sections, in order. A page's `section` must be one of them. */
export const SECTIONS = [
  "Getting started",
  "Clusters and resources",
  "Tools",
  "Integrations",
  "Insights",
  "Reference",
] as const;

export type Section = (typeof SECTIONS)[number];

export interface DocMeta {
  slug: string;
  title: string;
  section: string;
  order: number;
}

/**
 * A Markdown file's frontmatter. Only what the docs use: `key: value` lines,
 * where a value is a JSON string, number or array, or else a bare string.
 */
export function parseFrontmatter(md: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return {};
  const out: Record<string, unknown> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    let value: unknown = raw;
    if (/^["[]/.test(raw) || /^-?\d+(\.\d+)?$/.test(raw)) {
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
    }
    out[key] = value;
  }
  return out;
}

/** The pages the app routes to (its App.tsx), leaving out redirects and the catch-all. */
export function shellRoutes(appTsx: string): string[] {
  const routes: string[] = [];
  for (const m of appTsx.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([^}]*)\}/g)) {
    const [, path, element] = m;
    if (path === "*" || path!.endsWith("/*") || element!.includes("<Navigate")) continue;
    routes.push(path!);
  }
  return routes;
}

/** Pages grouped by section, in SECTIONS order, each section by `order`. */
export function sidebar<T extends DocMeta>(docs: T[]): { section: Section; items: T[] }[] {
  return SECTIONS.map((section) => ({
    section,
    items: docs.filter((d) => d.section === section).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
  })).filter((g) => g.items.length > 0);
}

/** The docs pages a page links to, by slug. */
export function docLinks(md: string): string[] {
  return [...md.matchAll(/\]\(\/docs\/([a-z0-9-]+)\/?(?:#[^)]*)?\)/g)].map((m) => m[1]!);
}

/** A sitemap of `paths` under `origin`. */
export function sitemapXml(origin: string, paths: string[]): string {
  const urls = paths.map((p) => `  <url>\n    <loc>${new URL(p, origin).href}</loc>\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
