import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, searchApi: { search: vi.fn() } };
});

import { searchApi, type SearchResponse } from "../api";
import { usePaletteRemote } from "../usePaletteRemote";

const reply = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  groups: [],
  filter: "",
  indexed: 0,
  pending: [],
  onDemand: [],
  truncated: [],
  denied: [],
  ...over,
});

const services = (names: string[]): SearchResponse["groups"] => [
  { slug: "services", label: "Services", total: names.length, clusterScoped: false, hits: names.map((n) => ({ ns: "shop", name: n, score: 100 })) },
];

const settle = (ms = 150) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(searchApi.search).mockReset().mockResolvedValue(reply());
});
afterEach(() => vi.useRealTimers());

describe("usePaletteRemote", () => {
  it("asks nothing while the palette is closed or the box is empty", async () => {
    renderHook(() => usePaletteRemote(false, ["prod"], "api"));
    renderHook(() => usePaletteRemote(true, ["prod"], ""));
    renderHook(() => usePaletteRemote(true, [], "api"));
    await settle();
    expect(searchApi.search).not.toHaveBeenCalled();
  });

  it("asks once typing pauses, not on every keystroke", async () => {
    const { rerender } = renderHook(({ q }) => usePaletteRemote(true, ["prod"], q), { initialProps: { q: "a" } });
    rerender({ q: "ap" });
    rerender({ q: "api" });
    await settle();
    expect(searchApi.search).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchApi.search).mock.calls[0]![0]).toBe("prod");
    expect(vi.mocked(searchApi.search).mock.calls[0]![1]).toBe("api");
  });

  it("turns the engine's answer into groups of hits that know their cluster and scope", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(
      reply({
        groups: [
          { slug: "ext--acme.example--v1--widgets", label: "Widgets", total: 1, clusterScoped: true, hits: [{ ns: "", name: "w1", score: 90 }] },
        ],
      }),
    );
    const { result } = renderHook(() => usePaletteRemote(true, ["prod"], "widget w"));
    await settle();
    const hit = result.current.groups[0]!.hits[0]!;
    expect(hit.obj).toMatchObject({ cluster: "prod", slug: "ext--acme.example--v1--widgets", ns: "", name: "w1", clusterScoped: true });
    expect(result.current.groups[0]!.label).toBe("Widgets");
  });

  it("keeps what a CRD result needs to open its objects, and the filter for 'show all'", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(
      reply({
        groups: [
          { slug: "crds", label: "CRDs", total: 1, clusterScoped: false, listQuery: "", hits: [{ ns: "", name: "scaledobjects.keda.sh", score: 90, ref: "ext--keda.sh--v1alpha1--scaledobjects", clusterScoped: false }] },
          { slug: "ext--keda.sh--v1alpha1--scaledobjects", label: "ScaledObjects", total: 9, clusterScoped: false, listQuery: "orders", hits: [{ ns: "shop", name: "orders-api", score: 90 }] },
        ],
      }),
    );
    const { result } = renderHook(() => usePaletteRemote(true, ["prod"], "scaled orders"));
    await settle();
    const crd = result.current.groups.find((g) => g.slug === "crds")!;
    expect(crd.hits[0]!.obj.ref).toBe("ext--keda.sh--v1alpha1--scaledobjects");
    const so = result.current.groups.find((g) => g.slug === "ext--keda.sh--v1alpha1--scaledobjects")!;
    expect(so.listQuery).toBe("orders");
  });

  it("asks every cluster in scope and merges the answers", async () => {
    vi.mocked(searchApi.search).mockImplementation(async (cluster) => reply({ groups: services([cluster === "prod" ? "api" : "api-stage"]) }));
    const { result } = renderHook(() => usePaletteRemote(true, ["prod", "stage"], "api"));
    await settle();
    expect(searchApi.search).toHaveBeenCalledTimes(2);
    const g = result.current.groups.find((x) => x.slug === "services")!;
    expect(g.total).toBe(2);
    expect(g.hits.map((h) => h.obj.cluster).sort()).toEqual(["prod", "stage"]);
  });

  it("does not ask for a kind the palette searches from memory", async () => {
    renderHook(() => usePaletteRemote(true, ["prod"], "deploy api"));
    renderHook(() => usePaletteRemote(true, ["prod"], "pod:web"));
    await settle();
    expect(searchApi.search).not.toHaveBeenCalled();
  });

  it("asks again while the engine is still listing, then stops", async () => {
    vi.mocked(searchApi.search)
      .mockResolvedValueOnce(reply({ pending: ["Ingresses"] }))
      .mockResolvedValueOnce(reply({ pending: ["Ingresses"] }))
      .mockResolvedValue(reply({ groups: services(["api"]) }));
    const { result } = renderHook(() => usePaletteRemote(true, ["prod"], "api"));
    await settle(150);
    expect(result.current.pending).toEqual(["Ingresses"]);
    await settle(1500);
    await settle(1500);
    expect(searchApi.search).toHaveBeenCalledTimes(3);
    expect(result.current.pending).toEqual([]);
    expect(result.current.groups[0]!.hits[0]!.obj.name).toBe("api");
    await settle(5000);
    expect(searchApi.search).toHaveBeenCalledTimes(3);
  });

  it("gives up polling after a while rather than asking forever", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ pending: ["Secrets"] }));
    renderHook(() => usePaletteRemote(true, ["prod"], "api"));
    await settle(150);
    for (let i = 0; i < 30; i++) await settle(1500);
    expect(vi.mocked(searchApi.search).mock.calls.length).toBeLessThanOrEqual(15);
  });

  it("cancels the request a newer query makes stale", async () => {
    const { rerender } = renderHook(({ q }) => usePaletteRemote(true, ["prod"], q), { initialProps: { q: "api" } });
    await settle(150);
    const first = vi.mocked(searchApi.search).mock.calls[0]![2] as AbortSignal;
    rerender({ q: "billing" });
    expect(first.aborted).toBe(true);
  });

  it("passes on what the engine could not do, so the palette can say so", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(
      reply({
        filter: "events",
        onDemand: ["Events", "Leases"],
        truncated: ["Secrets"],
        denied: [{ label: "Ingresses", reason: "forbidden: no list" }],
      }),
    );
    const { result } = renderHook(() => usePaletteRemote(true, ["prod"], "events crash"));
    await settle();
    expect(result.current).toMatchObject({ filter: "events", onDemand: ["Events", "Leases"], truncated: ["Secrets"], denied: [{ label: "Ingresses", reason: "forbidden: no list" }] });
  });

  it("fails quietly: an unreachable engine is a message, not a crash", async () => {
    vi.mocked(searchApi.search).mockRejectedValue(new Error("502 bad gateway"));
    const { result } = renderHook(() => usePaletteRemote(true, ["prod"], "api"));
    await settle();
    expect(result.current.error).toMatch(/502/);
    expect(result.current.groups).toEqual([]);
  });

  it("clears when the palette closes", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ groups: services(["api"]) }));
    const { result, rerender } = renderHook(({ open }) => usePaletteRemote(open, ["prod"], "api"), { initialProps: { open: true } });
    await settle();
    expect(result.current.groups).toHaveLength(1);
    rerender({ open: false });
    expect(result.current.groups).toEqual([]);
  });
});
