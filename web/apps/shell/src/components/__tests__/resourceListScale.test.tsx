import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { Profiler } from "react";
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

const nameOf = (p: Pod) => p.metadata.name;
const nsOf = (p: Pod) => p.metadata.namespace;
const createdOf = (p: Pod) => p.metadata.creationTimestamp;
const columns: ListColumn<Pod>[] = [
  { id: "Restarts", header: "Restarts", cell: (p) => <span>{p.restarts}</span>, sortValue: (p) => p.restarts },
];
const onOpen = vi.fn();
const menuItems = () => [];
const onDelete = vi.fn(() => Promise.resolve());

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

  // Backlog 90: every row was a ResizeObserver subscription (measureElement), and each mount of a
  // row re-rendered the whole list through the virtualiser. Rows have a fixed height.
  it("does not observe each row's size (fixed-height rows need no per-row ResizeObserver)", () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(el: Element) {
          observed.push(el);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      mount(pods(300));
      expect(document.querySelectorAll("tbody tr[data-index]").length).toBeGreaterThan(5);
      expect(observed.filter((e) => e.tagName === "TR")).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("re-sorts a stream flush that changed one row in about N comparisons, not N log N", () => {
    const N = 1000;
    // Name order differs from arrival order, as a real stream's does.
    const shuffled = pods(N).map((p, i) => ({ ...p, metadata: { ...p.metadata, name: `pod-${String((i * 7919) % N).padStart(5, "0")}` } }));
    const defaultSort = vi.fn((a: Pod, b: Pod) => a.metadata.name.localeCompare(b.metadata.name));
    const view = (rows: Pod[]) => (
      <ResourceListView<Pod>
        title="Pods"
        label="Pods"
        rows={rows}
        objects={rows as unknown as Record<string, unknown>[]}
        synced
        busy={false}
        live
        cluster="kind-test"
        nsFiltered={false}
        nameOf={nameOf}
        nsOf={nsOf}
        createdOf={createdOf}
        columns={columns}
        sortKey="test/perf-resort"
        onOpen={onOpen}
        menuItems={menuItems}
        onDelete={onDelete}
        defaultSort={defaultSort}
      />
    );
    const { rerender } = render(view(shuffled));
    const first = defaultSort.mock.calls.length;
    expect(first).toBeGreaterThan(N * 3); // a cold sort really is N log N
    defaultSort.mockClear();
    const next = shuffled.slice();
    next[10] = { ...next[10]!, restarts: 5 };
    rerender(view(next));
    expect(defaultSort.mock.calls.length).toBeGreaterThan(0);
    expect(defaultSort.mock.calls.length).toBeLessThanOrEqual(N * 3);
  });

  it("commits at most twice per scroll tick", () => {
    let commits = 0;
    const rows = pods(3000);
    render(
      <Profiler id="list" onRender={() => commits++}>
        <ResourceListView<Pod>
          title="Pods"
          label="Pods"
          rows={rows}
          objects={rows as unknown as Record<string, unknown>[]}
          synced
          busy={false}
          live
          cluster="kind-test"
          nsFiltered={false}
          nameOf={nameOf}
          nsOf={nsOf}
          createdOf={createdOf}
          columns={columns}
          sortKey="test/perf-scrollticks"
          onOpen={onOpen}
          menuItems={menuItems}
          onDelete={onDelete}
        />
      </Profiler>,
    );
    const wrap = document.querySelector(".table-wrap") as HTMLElement;
    const before = commits;
    const TICKS = 30;
    for (let i = 1; i <= TICKS; i++) {
      wrap.scrollTop = i * 64;
      act(() => {
        fireEvent.scroll(wrap);
      });
    }
    expect(commits - before).toBeLessThanOrEqual(TICKS * 2);
  });
});
