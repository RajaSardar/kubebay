import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildIndex, parseQuery, search, type SearchObject } from "../paletteSearch";

const o = (slug: string, ns: string, name: string, cluster = "prod"): SearchObject => ({ cluster, slug, ns, name });

describe("parseQuery", () => {
  it("treats plain words as terms across every kind", () => {
    expect(parseQuery("api")).toEqual({ slug: null, terms: ["api"] });
    expect(parseQuery("Shop API")).toEqual({ slug: null, terms: ["shop", "api"] });
  });

  it("reads a leading kind word, then a space, as 'only this kind'", () => {
    expect(parseQuery("deploy api")).toEqual({ slug: "deployments", terms: ["api"] });
    expect(parseQuery("sts payments db")).toEqual({ slug: "statefulsets", terms: ["payments", "db"] });
    expect(parseQuery("Pods web")).toEqual({ slug: "pods", terms: ["web"] });
  });

  it("reads kind:term and kind: too", () => {
    expect(parseQuery("pod:web")).toEqual({ slug: "pods", terms: ["web"] });
    expect(parseQuery("ns:")).toEqual({ slug: "namespaces", terms: [] });
    expect(parseQuery("Deployments:API")).toEqual({ slug: "deployments", terms: ["api"] });
  });

  it("does not treat a lone word as a kind until you press space, so you can still search for it", () => {
    expect(parseQuery("deploy")).toEqual({ slug: null, terms: ["deploy"] });
    expect(parseQuery("deploy ")).toEqual({ slug: "deployments", terms: [] });
  });

  it("leaves an unknown first word as a term", () => {
    expect(parseQuery("foo bar")).toEqual({ slug: null, terms: ["foo", "bar"] });
  });
});

describe("search", () => {
  const objs = [
    o("deployments", "shop", "api"),
    o("deployments", "shop", "api-gateway"),
    o("deployments", "billing", "legacy-api"),
    o("deployments", "ops", "tapir"),
    o("pods", "shop", "api-7d9f-x1"),
    o("services", "shop", "api"), // not a followed kind: ignored by the kind table but still searchable if present
    o("nodes", "", "ip-10-1-2-3"),
    o("namespaces", "", "shop"),
  ];
  const idx = buildIndex(objs);

  it("returns nothing for an empty query", () => {
    expect(search(idx, "")).toEqual([]);
    expect(search(idx, "   ")).toEqual([]);
  });

  it("ranks exact, then prefix, then word start, then substring", () => {
    const names = search(idx, "api")
      .find((g) => g.slug === "deployments")!
      .hits.map((h) => h.obj.name);
    expect(names).toEqual(["api", "api-gateway", "legacy-api", "tapir"]);
  });

  it("puts a shorter name ahead of a longer one with the same kind of match", () => {
    const names = search(idx, "api").find((g) => g.slug === "deployments")!.hits.map((h) => h.obj.name);
    expect(names.indexOf("api")).toBeLessThan(names.indexOf("api-gateway"));
  });

  it("matches a namespace when no name matches, ranked below name matches", () => {
    const hits = search(idx, "billing").flatMap((g) => g.hits.map((h) => h.obj.name));
    expect(hits).toEqual(["legacy-api"]);
  });

  it("needs every term to match, in the name or the namespace", () => {
    const hits = search(idx, "shop gateway").flatMap((g) => g.hits.map((h) => h.obj.name));
    expect(hits).toEqual(["api-gateway"]);
  });

  it("understands namespace/name", () => {
    const hits = search(idx, "billing/legacy").flatMap((g) => g.hits.map((h) => h.obj.name));
    expect(hits).toEqual(["legacy-api"]);
  });

  it("falls back to a loose in-order match, ranked last", () => {
    const hits = search(idx, "tpr").flatMap((g) => g.hits.map((h) => h.obj.name));
    expect(hits).toEqual(["tapir"]);
  });

  it("is case-insensitive", () => {
    expect(search(idx, "API").length).toBe(search(idx, "api").length);
  });

  it("groups by kind with the full count, and orders groups by their best hit", () => {
    const groups = search(idx, "api");
    expect(groups.map((g) => g.slug)[0]).toBe("deployments");
    const dep = groups.find((g) => g.slug === "deployments")!;
    expect(dep.total).toBe(4);
    expect(dep.label).toBe("Deployments");
  });

  it("caps each group's rows but still reports how many matched", () => {
    const many = buildIndex(Array.from({ length: 40 }, (_, i) => o("pods", "shop", `web-${i}`)));
    const g = search(many, "web", { perGroup: 5 })[0]!;
    expect(g.hits).toHaveLength(5);
    expect(g.total).toBe(40);
  });

  it("limits to one kind with a prefix and lists them all alphabetically when there is no term", () => {
    const groups = search(idx, "deploy api");
    expect(groups.map((g) => g.slug)).toEqual(["deployments"]);
    const listing = search(idx, "deploy ", { perGroup: 25 });
    expect(listing[0]!.hits.map((h) => h.obj.name)).toEqual(["api", "api-gateway", "legacy-api", "tapir"]);
  });

  it("keeps the cluster and the row each hit came from", () => {
    const row = { metadata: { name: "x" } };
    const i2 = buildIndex([{ cluster: "stage", slug: "pods", ns: "a", name: "web", row }]);
    const hit = search(i2, "web")[0]!.hits[0]!;
    expect(hit.obj.cluster).toBe("stage");
    expect(hit.obj.row).toBe(row);
  });

  it("stays fast over a hundred thousand objects", () => {
    const big = buildIndex(
      Array.from({ length: 100_000 }, (_, i) => o(["pods", "deployments", "nodes"][i % 3]!, `team-${i % 120}`, `svc-${i % 977}-${(i * 7919).toString(36)}`)),
    );
    const start = performance.now();
    search(big, "svc 12");
    expect(performance.now() - start).toBeLessThan(250);
  });
});


// The Go ranker in the engine answers for the kinds the app does not follow,
// and is tested against the same file. Regenerate it, after changing the
// ranking on purpose, with UPDATE_PARITY=1 and then run the Go tests.
const FIXTURE = resolve(__dirname, "../../../../../../engine/internal/searchindex/testdata/parity.json");

function parityNow() {
  const objects = [
    o("deployments", "shop", "api"),
    o("deployments", "shop", "api-gateway"),
    o("deployments", "billing", "legacy-api"),
    o("deployments", "ops", "tapir"),
    o("pods", "shop", "api-7d9f-x1"),
    o("services", "shop", "api"),
    o("nodes", "", "ip-10-1-2-3"),
    o("namespaces", "", "shop"),
    o("pods", "shop", "web-1"),
    o("pods", "shop", "web-2"),
    o("statefulsets", "data", "db_primary"),
    o("statefulsets", "data", "db.replica"),
  ];
  const idx = buildIndex(objects);
  const parse = ["api", "Shop API", "deploy api", "sts payments db", "Pods web", "pod:web", "ns:", "Deployments:API", "deploy", "deploy ", "foo bar", "", "   ", "switch", "ns", "ns "];
  const queries = ["api", "billing", "shop gateway", "billing/legacy", "tpr", "API", "deploy api", "deploy ", "pod web", "web", "ns:", "db", "primary", "shop/", "zzzz", "p", "-", "ip-10", "sts "];
  return {
    note: "Generated by the test in web/apps/shell/src/lib/__tests__/paletteSearch.test.ts (UPDATE_PARITY=1). Both the TypeScript and the Go ranker are tested against it.",
    objects: objects.map((x) => ({ slug: x.slug, ns: x.ns, name: x.name })),
    parse: parse.map((q) => {
      const p = parseQuery(q);
      return { q, slug: p.slug ?? "", terms: p.terms };
    }),
    search: queries.map((q) => ({
      q,
      groups: search(idx, q, { perGroup: 3 }).map((g) => ({
        slug: g.slug,
        total: g.total,
        hits: g.hits.map((h) => ({ ns: h.obj.ns, name: h.obj.name, score: h.score })),
      })),
    })),
  };
}

describe("parity with the engine's ranker", () => {
  it("gives the answers in the shared fixture", () => {
    const now = parityNow();
    if (process.env["UPDATE_PARITY"] === "1") writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + "\n");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(now);
  });
});
