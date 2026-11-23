import { afterEach, describe, expect, it, vi } from "vitest";
import { derivePod } from "../pods";

// Perf pass 3: derivePod runs for every pod on every stream flush. The stream
// replaces a pod's object when it changes and keeps the same object when it
// does not, so the derived row is cached per object. Counts derivations (reads
// of `status`, which derivePod makes once per pod), not time.

type Obj = Record<string, unknown>;
let derivations = 0;

function pod(i: number, rv = "1", phase = "Running"): Obj {
  return new Proxy(
    {
      metadata: { name: `pod-${i}`, namespace: "shop", creationTimestamp: "2026-11-01T00:00:00Z", resourceVersion: rv },
      spec: { nodeName: "node-a", containers: [{ name: "app" }] },
      status: { phase, containerStatuses: [{ name: "app", ready: true, restartCount: 0, state: { running: {} } }] },
    } as Obj,
    {
      get(t, k, r) {
        if (k === "status") derivations++;
        return Reflect.get(t, k, r);
      },
    },
  );
}

const flush = (rows: Obj[]) => rows.map(derivePod);

describe("derivePod cache", () => {
  afterEach(() => vi.useRealTimers());

  it("derives each pod once; a flush where nothing changed derives nothing", () => {
    const rows = Array.from({ length: 2000 }, (_, i) => pod(i));
    derivations = 0;
    const first = flush(rows);
    expect(derivations).toBe(2000);

    derivations = 0;
    const second = flush([...rows]);
    expect(derivations).toBe(0);
    second.forEach((r, i) => expect(r).toBe(first[i]));
  });

  it("a flush where one pod changed derives that one pod, and shows its new state", () => {
    const rows = Array.from({ length: 2000 }, (_, i) => pod(i));
    flush(rows);
    const next = [...rows];
    next[7] = pod(7, "2", "Failed");
    derivations = 0;
    const out = flush(next);
    expect(derivations).toBe(1);
    expect(out[7]).toMatchObject({ rv: "2", statusLabel: "Failed", status: "failed" });
  });

  it("the cached row does not depend on the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T01:00:00Z"));
    const p = pod(1);
    const a = derivePod(p);
    vi.setSystemTime(new Date("2026-11-03T01:00:00Z"));
    derivations = 0;
    expect(derivePod(p)).toBe(a);
    expect(derivations).toBe(0);
  });

  it("caches a nameless object's null too", () => {
    const o = { metadata: {} };
    expect(derivePod(o)).toBeNull();
    expect(derivePod(o)).toBeNull();
  });
});
