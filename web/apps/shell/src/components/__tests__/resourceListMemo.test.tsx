import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ResourceListView, type ResourceListViewProps } from "../ResourceListView";

// Perf pass 2: a stream flush hands the list a new rows array. Only the rows
// whose object changed may re-render their cells. Counts cell renders, not time.

interface Pod {
  name: string;
  rv: string;
  restarts: number;
}
const created = new Date().toISOString();
const pods = (n: number, rv = "1"): Pod[] => Array.from({ length: n }, (_, i) => ({ name: `pod-${i}`, rv, restarts: i }));

const nameOf = (p: Pod) => p.name;
const nsOf = () => "default";
const createdOf = () => created;
const versionOf = (p: Pod) => p.rv;
const onOpen = vi.fn();
const menuItems = () => [];
const onDelete = vi.fn(() => Promise.resolve());

function setup(initial: Pod[]) {
  const cell = vi.fn((p: Pod) => <span>{p.restarts}</span>);
  const columns = [{ id: "Restarts", header: "Restarts", cell, sortValue: (p: Pod) => p.restarts }];
  const props = (rows: Pod[]): ResourceListViewProps<Pod> => ({
    title: "Pods",
    label: "Pods",
    rows,
    objects: rows as unknown as Record<string, unknown>[],
    synced: true,
    busy: false,
    live: true,
    cluster: "kind-test",
    nsFiltered: false,
    nameOf,
    nsOf,
    createdOf,
    versionOf,
    columns,
    sortKey: "test/memo-pods",
    onOpen,
    menuItems,
    onDelete,
  });
  const r = render(<ResourceListView {...props(initial)} />);
  return { cell, rerender: (rows: Pod[]) => r.rerender(<ResourceListView {...props(rows)} />) };
}

describe("ResourceListView row memoisation", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("re-renders only the changed row when the rows array is rebuilt", () => {
    const base = pods(40);
    const { cell, rerender } = setup(base);
    cell.mockClear();
    // New array; the same objects except one with a new resourceVersion.
    rerender(base.map((p, i) => (i === 3 ? { ...p, rv: "2", restarts: 99 } : p)));
    // Twice at most: the new values, then the "changed" tint. Never another row.
    expect(cell.mock.calls.length).toBeLessThanOrEqual(2);
    expect(new Set(cell.mock.calls.map((c) => c[0].name))).toEqual(new Set(["pod-3"]));
  });

  it("treats a rebuilt object with the same resourceVersion as unchanged", () => {
    const base = pods(40);
    const { cell, rerender } = setup(base);
    cell.mockClear();
    // Workloads derives fresh row objects on every flush.
    rerender(base.map((p) => ({ ...p })));
    expect(cell).toHaveBeenCalledTimes(0);
  });

  it("selecting one row re-renders that row only", () => {
    const { cell } = setup(pods(40));
    cell.mockClear();
    fireEvent.click(document.querySelector("tbody tr[data-index='5'] input[type=checkbox]")!);
    expect(cell).toHaveBeenCalledTimes(1);
  });
});
