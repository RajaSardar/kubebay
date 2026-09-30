import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook } from "@testing-library/react";
import { useResourceList } from "../useResourceList";

// The list behaviour both tables share: filter, sort (remembered per table),
// keyboard, and the windowed rows. Slice 5 of docs/TABLE_UNIFICATION.md.

interface Job {
  ns: string;
  name: string;
  failed: number;
}
const jobs: Job[] = [
  { ns: "shop", name: "job-10", failed: 10 },
  { ns: "data", name: "job-9", failed: 9 },
  { ns: "shop", name: "backup", failed: 2 },
];

function setup(over: Partial<Parameters<typeof useResourceList<Job>>[0]> = {}) {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  const scroller = document.createElement("div");
  const head = document.createElement("thead");
  const opts = {
    rows: jobs,
    keyOf: (j: Job) => `${j.ns}/${j.name}`,
    filterFields: (j: Job) => [j.name, j.ns, String(j.failed)],
    sortValue: (j: Job, col: string) => (col === "Failed" ? j.failed : j.name),
    defaultSort: (a: Job, b: Job) => a.name.localeCompare(b.name),
    sortKey: "test/jobs",
    onOpen,
    onToggle,
    estimate: 43,
    scrollRef: { current: scroller },
    headerRef: { current: head },
    ...over,
  };
  const hook = renderHook((p: typeof opts) => useResourceList(p), { initialProps: opts });
  return { hook, onOpen, onToggle, opts };
}

const names = (r: { shown: Job[] }) => r.shown.map((j) => j.name);

describe("useResourceList", () => {
  beforeEach(() => localStorage.clear());

  it("lists every row in the default order, with their keys", () => {
    const { hook } = setup();
    expect(names(hook.result.current)).toEqual(["backup", "job-10", "job-9"]);
    expect(hook.result.current.allKeys).toEqual(["shop/backup", "shop/job-10", "data/job-9"]);
  });

  it("filters on the page's fields, every word must match", () => {
    const { hook } = setup();
    act(() => hook.result.current.setFilter("shop job"));
    expect(names(hook.result.current)).toEqual(["job-10"]);
  });

  it("sorts by a column, numbers as numbers, and toggles direction", () => {
    const { hook } = setup();
    act(() => hook.result.current.sort.toggle("Failed"));
    expect(names(hook.result.current)).toEqual(["backup", "job-9", "job-10"]);
    act(() => hook.result.current.sort.toggle("Failed"));
    expect(names(hook.result.current)).toEqual(["job-10", "job-9", "backup"]);
  });

  it("remembers the sort per table", () => {
    const first = setup();
    act(() => first.hook.result.current.sort.toggle("Failed"));
    first.hook.unmount();
    const again = setup();
    expect(again.hook.result.current.sort).toMatchObject({ col: "Failed", asc: true });
  });

  it("opens and selects the keyboard's active row", () => {
    const { hook, onOpen, onToggle } = setup();
    act(() => void fireEvent.keyDown(window, { key: "j" }));
    act(() => void fireEvent.keyDown(window, { key: "j" }));
    expect(hook.result.current.activeRow).toBe(1);
    act(() => void fireEvent.keyDown(window, { key: "Enter" }));
    expect(onOpen).toHaveBeenCalledWith(jobs[0]); // job-10, second in default order
    act(() => void fireEvent.keyDown(window, { key: "x" }));
    expect(onToggle).toHaveBeenCalledWith("shop/job-10");
  });

  it("clears the filter on Escape from the filter field", () => {
    const { hook } = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    hook.result.current.filterRef.current = input;
    act(() => hook.result.current.setFilter("backup"));
    act(() => void fireEvent.keyDown(input, { key: "Escape" }));
    expect(hook.result.current.filter).toBe("");
  });
});
