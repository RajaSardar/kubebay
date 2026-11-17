import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DataTable, SelectCell, Table, TableRow } from "@kubebay/ui";

// Selecting a row (backlog #40): the checkbox is a 14px box, which is a poor thing to have to hit.
// Anywhere in the selection cell toggles the row, the box itself still toggles it once, and neither
// opens the row's drawer.

describe("the row selection cell", () => {
  it("toggles the row when you click the cell around the checkbox, not only the box", () => {
    const onChange = vi.fn();
    const onRowClick = vi.fn();
    const { container } = render(
      <Table>
        <tbody>
          <TableRow clickable onClick={onRowClick}>
            <SelectCell checked={false} onChange={onChange} label="Select api" />
            <td>api</td>
          </TableRow>
        </tbody>
      </Table>,
    );
    fireEvent.click(container.querySelector("td.col-select")!);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("unticks a ticked row from the cell, too", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Table>
        <tbody>
          <tr>
            <SelectCell checked onChange={onChange} label="Select api" />
          </tr>
        </tbody>
      </Table>,
    );
    fireEvent.click(container.querySelector("td.col-select")!);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("toggles once, not twice, when you do hit the box", () => {
    const onChange = vi.fn();
    const onRowClick = vi.fn();
    render(
      <Table>
        <tbody>
          <TableRow clickable onClick={onRowClick}>
            <SelectCell checked={false} onChange={onChange} label="Select api" />
          </TableRow>
        </tbody>
      </Table>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select api" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe("DataTable row selection", () => {
  it("selects a row from the cell beside its checkbox, and still opens it from the name", () => {
    const onToggle = vi.fn();
    const onRowClick = vi.fn();
    const { container } = render(
      <DataTable
        columns={[{ key: "name", header: "Name", render: (p: { name: string }) => p.name }]}
        rows={[{ name: "api" }, { name: "worker" }]}
        rowKey={(p) => p.name}
        onRowClick={onRowClick}
        selection={{ selected: new Set<string>(), onToggle, onToggleAll: vi.fn() }}
      />,
    );
    fireEvent.click(container.querySelectorAll("tbody td.col-select")[1]!);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("worker");
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("api"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
