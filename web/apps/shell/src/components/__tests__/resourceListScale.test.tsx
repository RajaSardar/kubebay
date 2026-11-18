import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ResourceListView, type ListColumn, type ResourceListViewProps } from "../ResourceListView";

// Perf regressions for the one list every resource table renders through.
// Counts work (cell renders, sortValue calls, DOM rows) rather than wall time,
// so the bounds hold however loaded CI is. See docs/PERFORMANCE_AUDIT.md.

interface Pod {
  metadata: { name: string; namespace: string; creationTimestamp: string };
  restarts: number;
}
const created = new Date().toISOString();
const pods = (n: number): Pod[] =>
  Array.from({ length: n }, (_, i) => ({
    metadata: { name: `pod-${i}`, namespace: `ns${i % 20}`, creationTimestamp: created },
    restarts: (i * 7919) % 1000,
  }));

function mount(rows: Pod[], column: Partial<ListColumn<Pod>> = {}) {
  const props: ResourceListViewProps<Pod> = {
    title: "Pods",
    label: "Pods",
    rows,
    objects: rows as unknown as Record<string, unknown>[],
    synced: true,
    busy: false,
    live: true,
    cluster: "kind-test",
    nsFiltered: false,
    nameOf: (p) => p.metadata.name,
    nsOf: (p) => p.metadata.namespace,
    createdOf: (p) => p.metadata.creationTimestamp,
    columns: [
      { id: "Restarts", header: "Restarts", cell: (p) => <span>{p.restarts}</span>, sortValue: (p) => p.restarts, ...column },
    ],
    sortKey: "test/perf-pods",
    onOpen: vi.fn(),
    menuItems: () => [],
    onDelete: vi.fn(() => Promise.resolve()),
  };
  return render(<ResourceListView {...props} />);
}

describe("ResourceListView at scale", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("renders a window of rows, not all of them", () => {
    mount(pods(3000));
    const rendered = document.querySelectorAll("tbody tr[data-index]").length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(150);
  });

  it("does not re-render the rows when the pointer moves over them", () => {
    const cell = vi.fn((p: Pod) => <span>{p.restarts}</span>);
    mount(pods(60), { cell });
    const rows = [...document.querySelectorAll("tbody tr[data-index]")];
    expect(rows.length).toBeGreaterThan(5);
    const before = cell.mock.calls.length;
    for (const r of rows.slice(0, 8)) {
      fireEvent.mouseEnter(r);
      fireEvent.mouseLeave(r);
    }
    expect(cell.mock.calls.length).toBe(before);
  });

  it("computes each row's sort value once per sort, not once per comparison", () => {
    const N = 2000;
    const sortValue = vi.fn((p: Pod) => p.restarts);
    mount(pods(N), { sortValue });
    sortValue.mockClear();
    const header = [...document.querySelectorAll("th")].find((h) => h.textContent === "Restarts")!;
    fireEvent.click(header);
    // A comparison sort makes ~N log2 N (about 22000) comparisons; allow a few passes over the rows.
    expect(sortValue.mock.calls.length).toBeGreaterThan(0);
    expect(sortValue.mock.calls.length).toBeLessThanOrEqual(N * 3);
  });
});
