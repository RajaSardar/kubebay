import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  Button,
  DataTable,
  EmptyState,
  InlineBanner,
  NsPill,
  SelectAllHeader,
  SelectCell,
  SkeletonRows,
  SortHeader,
  Table,
  TableRow,
  TableWrap,
  type Column,
} from "@kubebay/ui";

describe("Button", () => {
  it("passes native button props through and forwards its ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} variant="ghost" title="Reload list" type="submit" aria-label="Reload">
        Reload
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Reload" });
    expect(b).toHaveClass("kb-btn", "kb-btn-ghost");
    expect(b).toHaveAttribute("title", "Reload list");
    expect(b).toHaveAttribute("type", "submit");
    expect(ref.current).toBe(b);
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Apply</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("has a danger-ghost variant for the first step of a destructive action", () => {
    render(<Button variant="danger-ghost">Delete</Button>);
    expect(screen.getByRole("button")).toHaveClass("kb-btn", "kb-btn-ghost", "kb-btn-danger-ghost");
  });
});

describe("EmptyState", () => {
  it("renders a title and a muted hint", () => {
    render(<EmptyState title="No pods match." hint="Loosen the filters." />);
    expect(screen.getByText("No pods match.").closest(".empty-state")).not.toBeNull();
    expect(screen.getByText("Loosen the filters.")).toHaveClass("muted", "small");
  });

  it("also takes free-form children and style", () => {
    const { container } = render(
      <EmptyState style={{ padding: 14 }}>
        <p>Custom body</p>
      </EmptyState>,
    );
    expect(container.firstChild).toHaveClass("empty-state");
    expect(container.firstChild).toHaveStyle({ padding: "14px" });
  });
});

describe("InlineBanner", () => {
  it("is an error by default and takes ok/warn tones, role and actions", () => {
    const { rerender, container } = render(<InlineBanner role="alert">Failed</InlineBanner>);
    expect(container.firstChild).toHaveClass("inline-banner");
    expect(container.firstChild).toHaveAttribute("role", "alert");
    rerender(
      <InlineBanner tone="warn" actions={<button>Undo</button>}>
        Changed
      </InlineBanner>,
    );
    expect(container.firstChild).toHaveClass("inline-banner", "warn");
    expect(screen.getByRole("button", { name: "Undo" }).parentElement).toHaveClass("inline-banner-actions");
  });
});

describe("table primitives", () => {
  it("compose into the ResourceTable markup", () => {
    const onSort = vi.fn();
    const onToggleAll = vi.fn();
    const onToggle = vi.fn();
    render(
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <SelectAllHeader checked={false} indeterminate onChange={onToggleAll} />
              <SortHeader label="Name" active asc onSort={onSort} />
              <SortHeader label="Age" onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            <TableRow selected dimmed clickable>
              <SelectCell checked onChange={onToggle} label="Select api" />
              <td>
                <NsPill onClick={() => {}}>default</NsPill>
              </td>
              <td>2h</td>
            </TableRow>
          </tbody>
        </Table>
      </TableWrap>,
    );
    const table = screen.getByRole("table");
    expect(table).toHaveClass("kb-table");
    expect(table.parentElement).toHaveClass("table-wrap");
    const name = screen.getByRole("columnheader", { name: /Name/ });
    expect(name).toHaveClass("th-sortable");
    expect(name).toHaveAttribute("aria-sort", "ascending");
    expect(within(name).getByText("↑")).toHaveClass("sort-indicator");
    fireEvent.click(screen.getByRole("columnheader", { name: "Age" }));
    expect(onSort).toHaveBeenCalledWith("Age");
    const all = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select api" }));
    expect(onToggle).toHaveBeenCalled();
    const row = screen.getByText("2h").closest("tr")!;
    expect(row).toHaveClass("selected", "row-clickable");
    expect(row).toHaveAttribute("data-terminating");
    expect(screen.getByText("default")).toHaveClass("ns-pill");
  });

  it("SkeletonRows fills a loading table", () => {
    render(
      <table>
        <tbody>
          <SkeletonRows columns={3} rows={2} leadingBlank />
        </tbody>
      </table>,
    );
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelectorAll("td")).toHaveLength(4);
    expect(rows[0]!.querySelectorAll(".kb-skeleton")).toHaveLength(3);
  });
});

describe("DataTable", () => {
  type Pod = { name: string; phase: string; age: string };
  const pods: Pod[] = [
    { name: "api", phase: "Running", age: "2h" },
    { name: "worker", phase: "Pending", age: "5m" },
  ];
  const columns: Column<Pod>[] = [
    { key: "name", header: "Name", sortable: true, className: "mono td-name", render: (p) => p.name },
    { key: "phase", header: "Status", render: (p) => p.phase },
    { key: "age", header: "Age", width: 60, render: (p) => p.age },
  ];

  it("renders headers and rows from column definitions", () => {
    render(<DataTable columns={columns} rows={pods} rowKey={(p) => p.name} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Status", "Age"]);
    expect(screen.getByText("api")).toHaveClass("mono", "td-name");
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("sorts via the header, selects rows, and reports row clicks", () => {
    const onSort = vi.fn();
    const onRowClick = vi.fn();
    const onToggle = vi.fn();
    const onToggleAll = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={pods}
        rowKey={(p) => p.name}
        sort={{ key: "name", asc: false }}
        onSort={onSort}
        onRowClick={onRowClick}
        selection={{ selected: new Set(["api"]), onToggle, onToggleAll }}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("columnheader", { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith("name");
    fireEvent.click(screen.getByText("worker"));
    expect(onRowClick).toHaveBeenCalledWith(pods[1]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select worker" }));
    expect(onToggle).toHaveBeenCalledWith("worker");
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText("api").closest("tr")).toHaveClass("selected");
    const all = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    fireEvent.click(all);
    expect(onToggleAll).toHaveBeenCalledWith(true);
  });

  it("shows the empty state or skeleton rows instead of an empty table", () => {
    const { rerender } = render(
      <DataTable columns={columns} rows={[]} rowKey={(p) => p.name} empty={<EmptyState title="No pods." />} />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No pods.")).toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={[]} rowKey={(p) => p.name} loading />);
    expect(screen.getByRole("table").querySelectorAll(".kb-skeleton").length).toBeGreaterThan(0);
  });
});
