import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResourceListView, type ListColumn } from "../ResourceListView";

// #21 in a real list: the chooser hides, shows and reorders columns, the
// layout is remembered per table, Name stays first, and a hidden column no
// longer sorts the table or answers plain words (docs/TABLE_FOLLOWUPS.md).

interface Node {
  name: string;
  zone: string;
  pods: number;
}
const now = new Date().toISOString();
const nodes: Node[] = [
  { name: "b-node", zone: "us-east-1a", pods: 9 },
  { name: "a-node", zone: "us-east-1b", pods: 30 },
];
const columns: ListColumn<Node>[] = [
  { id: "Pods", header: "Pods", cell: (n) => n.pods, sortValue: (n) => n.pods },
  { id: "Zone", header: "Zone", cell: (n) => n.zone, filterText: (n) => n.zone, filterKey: "zone", defaultHidden: true },
];

function renderNodes() {
  return render(
    <ResourceListView<Node>
      title="Nodes"
      label="Nodes"
      rows={nodes}
      objects={[]}
      synced
      busy={false}
      live
      cluster="kind-test"
      scoped
      nsFiltered={false}
      nameOf={(n) => n.name}
      nsOf={() => ""}
      createdOf={() => now}
      columns={columns}
      sortKey="r/nodes"
      onOpen={() => {}}
      menuItems={() => []}
      onDelete={() => Promise.resolve()}
    />,
  );
}
const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent).filter(Boolean);
const names = () => [...document.querySelectorAll("tbody tr[data-index] .td-name")].map((td) => td.textContent);
const openChooser = () => fireEvent.click(screen.getByRole("button", { name: "Columns" }));

describe("columns in a list", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("starts with default-hidden columns hidden and Name first", () => {
    renderNodes();
    expect(headers()).toEqual(["Name", "Pods", "Age"]);
  });

  it("shows, hides and reorders from the chooser, and remembers it", () => {
    const view = renderNodes();
    openChooser();
    fireEvent.click(screen.getByRole("checkbox", { name: "Zone" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Zone up" }));
    expect(headers()).toEqual(["Name", "Zone", "Pods", "Age"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Age" }));
    expect(headers()).toEqual(["Name", "Zone", "Pods"]);
    view.unmount();
    renderNodes();
    expect(headers()).toEqual(["Name", "Zone", "Pods"]);
  });

  it("stops sorting by a column once it is hidden, and resumes when it is shown", () => {
    renderNodes();
    fireEvent.click(screen.getByRole("columnheader", { name: /^Pods/ }));
    expect(names()).toEqual(["b-node", "a-node"]); // 9 pods before 30
    openChooser();
    fireEvent.click(screen.getByRole("checkbox", { name: "Pods" }));
    expect(names()).toEqual(["a-node", "b-node"]); // by name, the default
    fireEvent.click(screen.getByRole("checkbox", { name: "Pods" }));
    expect(names()).toEqual(["b-node", "a-node"]);
  });

  it("plain words skip hidden columns; a key still reaches them", () => {
    renderNodes();
    const filter = screen.getByRole("textbox", { name: "Filter nodes" });
    fireEvent.change(filter, { target: { value: "1b" } });
    expect(names()).toEqual([]);
    fireEvent.change(filter, { target: { value: "zone:1b" } });
    expect(names()).toEqual(["a-node"]);
  });
});
