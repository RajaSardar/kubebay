import { describe, expect, it } from "vitest";
import type { ClusterInfo, ColdSearchResponse } from "../api";
import type { SearchGroup } from "../paletteSearch";
import { MAX_COLD_IDS, MAX_RESULTS, coldNotes, coldTargets, crossClusterRows } from "../crossClusterSearch";

const cluster = (id: string, over: Partial<ClusterInfo> = {}): ClusterInfo => ({ id, context: id, server: "https://x", status: "reachable", ...over });

const group = (slug: string, label: string, hits: [cluster: string, ns: string, name: string, score: number][], total = hits.length): SearchGroup => ({
  slug,
  label,
  total,
  hits: hits.map(([c, ns, name, score]) => ({ score, obj: { cluster: c, slug, ns, name } })),
});

describe("coldTargets", () => {
  it("is every cluster with no streams open that can build a client, not hidden", () => {
    const list = [cluster("prod"), cluster("stage"), cluster("broken", { status: "misconfigured" }), cluster("old"), cluster("dev", { status: "unreachable" })];
    const got = coldTargets(list, new Set(["prod"]), { old: { hidden: true } });
    expect(got).toEqual(["stage", "dev"]);
  });

  it("asks for at most as many clusters as the engine answers", () => {
    const list = Array.from({ length: MAX_COLD_IDS + 30 }, (_, i) => cluster(`c${i}`));
    expect(coldTargets(list, new Set(), {})).toHaveLength(MAX_COLD_IDS);
  });
});

describe("crossClusterRows", () => {
  it("joins connected and disconnected results into one ranked list that names each one's cluster and kind", () => {
    const warm = [group("deployments", "Deployments", [["prod", "shop", "api-gateway", 90]]), group("services", "Services", [["prod", "shop", "api", 100]])];
    const cold: ColdSearchResponse["hits"] = [{ cluster: "stage", slug: "deployments", kind: "Deployments", ns: "shop", name: "web-api", score: 70 }];
    const { rows, total, capped } = crossClusterRows(warm, cold, { listing: false });
    expect(rows.map((r) => [r.cluster, r.kind, r.ns, r.name, r.connected])).toEqual([
      ["prod", "Services", "shop", "api", true],
      ["prod", "Deployments", "shop", "api-gateway", true],
      ["stage", "Deployments", "shop", "web-api", false],
    ]);
    expect(total).toBe(3);
    expect(capped).toBe(false);
  });

  it("lists a kind alphabetically when the query only named it", () => {
    const warm = [group("services", "Services", [["prod", "shop", "web", 1], ["prod", "shop", "api", 1]])];
    const { rows } = crossClusterRows(warm, [{ cluster: "stage", slug: "services", kind: "Services", ns: "a", name: "b", score: 1 }], { listing: true });
    expect(rows.map((r) => r.name)).toEqual(["api", "b", "web"]);
  });

  it("caps the list and counts what it left out", () => {
    const hits: [string, string, string, number][] = Array.from({ length: MAX_RESULTS + 5 }, (_, i) => ["prod", "ns", `api-${i}`, 90]);
    const { rows, total, capped } = crossClusterRows([group("pods", "Pods", hits, MAX_RESULTS + 50)], [], { listing: false });
    expect(rows).toHaveLength(MAX_RESULTS);
    expect(total).toBe(MAX_RESULTS + 50);
    expect(capped).toBe(true);
  });

  it("shows an object once even if two places found it", () => {
    const warm = [group("deployments", "Deployments", [["prod", "shop", "api", 100]])];
    const cold: ColdSearchResponse["hits"] = [{ cluster: "prod", slug: "deployments", kind: "Deployments", ns: "shop", name: "api", score: 100 }];
    expect(crossClusterRows(warm, cold, { listing: false }).rows).toHaveLength(1);
  });
});

describe("coldNotes", () => {
  const res = (clusters: ColdSearchResponse["clusters"], over: Partial<ColdSearchResponse> = {}): ColdSearchResponse => ({
    hits: [],
    total: 0,
    capped: false,
    kinds: ["Pods", "Deployments"],
    clusters,
    ...over,
  });
  const name = (id: string) => (id === "eu" ? "Europe" : id);

  it("says which clusters couldn't be searched and why, by name", () => {
    const notes = coldNotes(res([{ id: "eu", error: "Pods: connection refused", denied: [], truncated: [], hits: 0 }]), name);
    expect(notes).toEqual([{ key: "error:eu", tone: "err", text: "Europe: couldn't search it. Pods: connection refused" }]);
  });

  it("turns a forbidden kind into a note on that cluster, with the reason", () => {
    const notes = coldNotes(res([{ id: "eu", denied: [{ label: "Deployments", reason: "deployments is forbidden" }], truncated: [], hits: 1 }]), name);
    expect(notes[0]).toMatchObject({ tone: "warn", text: "Europe: your access can't list Deployments. deployments is forbidden" });
  });

  it("says what is still being searched, and what was too large to search in full", () => {
    const notes = coldNotes(
      res([
        { id: "a", pending: true, denied: [], truncated: [], hits: 0 },
        { id: "b", pending: true, denied: [], truncated: [], hits: 0 },
        { id: "c", denied: [], truncated: ["Pods"], hits: 0 },
      ]),
      name,
    );
    expect(notes.map((n) => n.text)).toEqual(["Still searching 2 clusters. More may appear.", "c: too many Pods to search them all."]);
  });

  it("passes on why nothing was searched", () => {
    const notes = coldNotes(res([], { unsupported: "Custom resources and CRDs aren't searched in clusters that aren't connected." }), name);
    expect(notes).toEqual([{ key: "unsupported", tone: "info", text: "Custom resources and CRDs aren't searched in clusters that aren't connected." }]);
  });
});
