import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SelectionBar, VisuallyHidden } from "@kubebay/ui";
import { ResourceListView } from "../ResourceListView";
import { useCompare } from "../../lib/compare-store";

// #26: bulk actions live in a bar under the table that says exactly what is
// selected, including rows the filter hides (docs/TABLE_FOLLOWUPS.md).

interface Job {
  ns: string;
  name: string;
}
const now = new Date().toISOString();
const jobs: Job[] = [
  { ns: "shop", name: "web" },
  { ns: "shop", name: "api" },
  { ns: "data", name: "etl" },
  ...Array.from({ length: 6 }, (_, i) => ({ ns: "batch", name: `run-${i}` })),
];

function renderJobs(onDelete = vi.fn(() => Promise.resolve()), gvr: string | undefined = "batch/v1/jobs") {
  render(
    <ResourceListView<Job>
      title="Jobs"
      label="Jobs"
      rows={jobs}
      objects={[]}
      synced
      busy={false}
      live
      cluster="kind-test"
      gvr={gvr || undefined}
      kind="Job"
      nsFiltered={false}
      nameOf={(j) => j.name}
      nsOf={(j) => j.ns}
      createdOf={() => now}
      columns={[]}
      sortKey="test/bar"
      onOpen={() => {}}
      menuItems={() => []}
      onDelete={onDelete}
    />,
  );
  return onDelete;
}
const bar = () => screen.getByRole("region", { name: "Selection" });
const filter = (q: string) => fireEvent.change(screen.getByRole("textbox", { name: "Filter jobs" }), { target: { value: q } });

describe("selection bar", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("@kubebay/ui SelectionBar is a named region; VisuallyHidden hides text from sight only", () => {
    render(
      <>
        <SelectionBar>2 selected</SelectionBar>
        <VisuallyHidden>for screen readers</VisuallyHidden>
      </>,
    );
    expect(screen.getByRole("region", { name: "Selection" })).toHaveClass("kb-selection-bar");
    expect(screen.getByText("for screen readers")).toHaveClass("kb-visually-hidden");
  });

  it("appears with the selection, holds the bulk delete, and the header no longer does", () => {
    renderJobs();
    expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select web" }));
    expect(within(bar()).getByText("1 selected")).toBeInTheDocument();
    expect(within(bar()).getByRole("button", { name: "Delete 1 selected" })).toBeInTheDocument();
    expect(within(document.querySelector(".page-header") as HTMLElement).queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("says when select-all took every row the filter matches", () => {
    renderJobs();
    filter("shop");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(within(bar()).getByText(/All 2 jobs matching “shop” selected/)).toBeInTheDocument();
  });

  it("counts selected rows the filter hides, and can deselect them", () => {
    renderJobs();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select web" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select etl" }));
    filter("shop");
    expect(within(bar()).getByText("2 selected")).toBeInTheDocument();
    expect(within(bar()).getByText(/1 hidden by filter/)).toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole("button", { name: "Deselect hidden" }));
    expect(within(bar()).getByText("1 selected")).toBeInTheDocument();
    expect(within(bar()).queryByText(/hidden by filter/)).toBeNull();
  });

  it("offers Compare only when exactly two rows are selected, and opens them in the compare dialog", () => {
    renderJobs();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select web" }));
    expect(within(bar()).queryByRole("button", { name: "Compare" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select etl" }));
    fireEvent.click(within(bar()).getByRole("button", { name: "Compare" }));
    const { open, left, right } = useCompare.getState();
    expect(open).toBe(true);
    expect([left?.ns + "/" + left?.name, right?.ns + "/" + right?.name].sort()).toEqual(["data/etl", "shop/web"]);
    expect(left).toMatchObject({ cluster: "kind-test", gvr: "batch/v1/jobs", kind: "Job" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select api" }));
    expect(within(bar()).queryByRole("button", { name: "Compare" })).toBeNull();
  });

  it("has no Compare when the page gives no gvr", () => {
    renderJobs(undefined, "");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select web" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select etl" }));
    expect(within(bar()).queryByRole("button", { name: "Compare" })).toBeNull();
  });

  it("clears on Escape and from its Clear button", () => {
    renderJobs();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select web" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select api" }));
    fireEvent.click(within(bar()).getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
  });

  it("tells screen readers the count", () => {
    renderJobs();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select web" }));
    expect(screen.getByRole("status", { name: "" }).textContent).toMatch(/1 selected/);
  });

  it("confirms a bulk delete with the names, where they are, and focus on Cancel", () => {
    renderJobs();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(within(bar()).getByRole("button", { name: "Delete 9 selected" }));
    const banner = screen.getByText(/can.t be undone/).closest(".inline-banner") as HTMLElement;
    for (const n of ["api", "etl", "run-0", "run-1", "run-2"]) expect(within(banner).getByText(n)).toBeInTheDocument();
    expect(within(banner).getByText(/\+4 more/)).toBeInTheDocument();
    expect(within(banner).getByText(/across 3 namespaces/)).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
});
