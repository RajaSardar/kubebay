import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChangedRows } from "../useChangedRows";

// #24: a row whose shown data changed tints for about a second
// (docs/TABLE_FOLLOWUPS.md). A resourceVersion change is the cheap signal;
// the row tints only if a value it shows changed, so a Node heartbeat that
// bumps resourceVersion without changing any column does not flicker.

interface Pod {
  name: string;
  rv: string;
  status: string;
  note?: string;
}
const keyOf = (p: Pod) => p.name;
const versionOf = (p: Pod) => p.rv;
const signatureOf = (p: Pod) => p.status;

function setup(rows: Pod[], synced = true) {
  return renderHook((p: { rows: Pod[]; synced: boolean }) => useChangedRows(p.rows, keyOf, versionOf, signatureOf, p.synced), {
    initialProps: { rows, synced },
  });
}

describe("useChangedRows", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tints nothing on the first load", () => {
    const h = setup([{ name: "a", rv: "1", status: "Running" }]);
    expect(h.result.current.size).toBe(0);
  });

  it("tints a row whose shown value changed, for about a second", () => {
    const h = setup([{ name: "a", rv: "1", status: "Running" }, { name: "b", rv: "1", status: "Running" }]);
    h.rerender({ rows: [{ name: "a", rv: "2", status: "CrashLoopBackOff" }, { name: "b", rv: "1", status: "Running" }], synced: true });
    expect([...h.result.current]).toEqual(["a"]);
    act(() => void vi.advanceTimersByTime(1100));
    expect(h.result.current.size).toBe(0);
  });

  it("does not tint a new version that changes nothing the table shows", () => {
    const h = setup([{ name: "node-1", rv: "1", status: "Ready" }]);
    h.rerender({ rows: [{ name: "node-1", rv: "2", status: "Ready", note: "heartbeat" }], synced: true });
    expect(h.result.current.size).toBe(0);
  });

  it("does not tint rows that arrive or a re-sync", () => {
    const h = setup([{ name: "a", rv: "1", status: "Running" }]);
    h.rerender({ rows: [{ name: "a", rv: "1", status: "Running" }, { name: "new", rv: "5", status: "Pending" }], synced: true });
    expect(h.result.current.size).toBe(0);
    h.rerender({ rows: [], synced: false });
    h.rerender({ rows: [{ name: "a", rv: "9", status: "Failed" }], synced: true });
    expect(h.result.current.size).toBe(0);
  });
});
