import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ResourceListView, type ListColumn, type ResourceListViewProps } from "../ResourceListView";

// The one list every resource table renders through: header count, filter,
// sort, selection, bulk delete, skeleton and empty states, row menu.
// Slice 6 of docs/TABLE_UNIFICATION.md.

interface Job {
  metadata: { name: string; namespace: string; creationTimestamp: string; deletionTimestamp?: string };
  failed: number;
}
const now = new Date().toISOString();
const jobs: Job[] = [
  { metadata: { name: "job-10", namespace: "shop", creationTimestamp: now }, failed: 10 },
  { metadata: { name: "job-9", namespace: "data", creationTimestamp: now }, failed: 9 },
  { metadata: { name: "backup", namespace: "shop", creationTimestamp: now, deletionTimestamp: now }, failed: 2 },
];
const failedCol: ListColumn<Job> = {
  id: "Failed",
  header: "Failed",
  cell: (j) => <span>{j.failed}</span>,
  sortValue: (j) => j.failed,
  filterText: (j) => String(j.failed),
};

function renderView(over: Partial<ResourceListViewProps<Job>> = {}) {
  const props: ResourceListViewProps<Job> = {
    title: "Jobs",
    label: "Jobs",
    rows: jobs,
    objects: jobs as unknown as Record<string, unknown>[],
    synced: true,
    busy: false,
    live: true,
    cluster: "kind-test",
    nsFiltered: false,
    nameOf: (j) => j.metadata.name,
    nsOf: (j) => j.metadata.namespace,
    createdOf: (j) => j.metadata.creationTimestamp,
    isDimmed: (j) => !!j.metadata.deletionTimestamp,
    columns: [failedCol],
    sortKey: "test/jobs",
    onOpen: vi.fn(),
    menuItems: (_j, { requestDelete }) => [
      { label: "View details", onClick: () => {} },
      { label: "Delete", danger: true, onClick: requestDelete },
    ],
    onDelete: vi.fn(() => Promise.resolve()),
    ...over,
  };
  render(<ResourceListView {...props} />);
  return props;
}

const names = () =>
  [...document.querySelectorAll("tbody tr[data-index] .td-name")].map((td) => td.textContent);

describe("ResourceListView", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("lists rows by name with namespace, page columns and age, counted in the header", () => {
    renderView();
    expect(names()).toEqual(["backup", "job-9", "job-10"]);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["", "Name", "Namespace", "Failed", "Age", ""]);
    expect(screen.getByText("3")).toHaveClass("kb-badge");
    expect(screen.getAllByText("shop")[0]).toHaveClass("ns-pill");
  });

  it("filters on name, namespace and the columns' filter text", () => {
    renderView();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter jobs" }), { target: { value: "data" } });
    expect(names()).toEqual(["job-9"]);
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("sorts a column by its sort value, from a click or the keyboard", () => {
    renderView();
    const failed = screen.getByRole("columnheader", { name: "Failed" });
    fireEvent.click(failed);
    expect(names()).toEqual(["backup", "job-9", "job-10"]);
    fireEvent.keyDown(failed, { key: "Enter" });
    expect(names()).toEqual(["job-10", "job-9", "backup"]);
  });

  it("opens a row on click and dims one being deleted", () => {
    const p = renderView();
    fireEvent.click(screen.getByText("job-9"));
    expect(p.onOpen).toHaveBeenCalledWith(jobs[1]);
    expect(screen.getByText("backup").closest("tr")).toHaveAttribute("data-terminating");
    expect(screen.getByText("job-9").closest("tr")).not.toHaveAttribute("data-terminating");
  });

  it("deletes the selected rows after a confirmation", async () => {
    const p = renderView();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select job-9" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 selected" }));
    expect(screen.getByText(/can.t be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(p.onDelete).toHaveBeenCalledWith({ ns: "data", name: "job-9" }, undefined));
  });

  it("opens the row menu from the kebab with the page's items", () => {
    renderView();
    const row = screen.getByText("job-10").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Row actions" }));
    expect(screen.getByText("View details")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete"));
    expect(screen.getByText(/can.t be undone/)).toBeInTheDocument();
  });

  it("sketches the table until the first sync, then says when nothing matches", () => {
    renderView({ rows: [], synced: false });
    expect(screen.getByRole("status", { name: "Loading jobs…" })).toBeInTheDocument();
  });

  it("says why the list is empty", () => {
    renderView();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter jobs" }), { target: { value: "nope" } });
    expect(screen.getByText("No jobs match.")).toBeInTheDocument();
    expect(screen.getByText("Loosen the filters.")).toBeInTheDocument();
  });

  it("leaves out the Namespace column for cluster-scoped kinds", () => {
    renderView({ scoped: true });
    expect(screen.queryByRole("columnheader", { name: "Namespace" })).toBeNull();
  });

  it("takes a page's own touches: order, header count text, filter hint, cell class and title, menu label", () => {
    renderView({
      title: "Workloads",
      titleCount: "· Jobs",
      filterPlaceholder: "Filter by name or failures…  /",
      defaultSort: (a, b) => b.failed - a.failed,
      menuLabel: (name) => `Actions for ${name}`,
      columns: [{ ...failedCol, className: (j) => (j.failed > 9 ? "mono warn" : "mono"), title: (j) => `${j.failed} failed` }],
    });
    expect(names()).toEqual(["job-10", "job-9", "backup"]);
    expect(screen.getByText("· Jobs")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/^Filter by name or failures…/)).toBeInTheDocument();
    const cell = screen.getByText("10").closest("td")!;
    expect(cell).toHaveClass("mono", "warn");
    expect(cell).toHaveAttribute("title", "10 failed");
    expect(screen.getByText("9").closest("td")).not.toHaveClass("warn");
    expect(screen.getByRole("button", { name: "Actions for job-9" })).toBeInTheDocument();
  });
});
