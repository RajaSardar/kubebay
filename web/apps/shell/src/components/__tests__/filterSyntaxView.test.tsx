import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResourceListView, type ListColumn } from "../ResourceListView";

// #25 in a real list: tokens reach named fields, columns opt in with a
// filterKey, labels come from labelsOf, and a hint says what was understood.

interface Pod {
  ns: string;
  name: string;
  status: string;
  labels: Record<string, string>;
}
const now = new Date().toISOString();
const pods: Pod[] = [
  { ns: "shop", name: "web-1", status: "Running", labels: { app: "web" } },
  { ns: "shop", name: "cart-1", status: "CrashLoopBackOff", labels: { app: "cart" } },
  { ns: "data", name: "etl-1", status: "Running", labels: { app: "etl" } },
];
const status: ListColumn<Pod> = { id: "Status", header: "Status", filterKey: "status", cell: (p) => p.status, filterText: (p) => p.status };

function renderPods() {
  render(
    <ResourceListView<Pod>
      title="Pods"
      label="Pods"
      rows={pods}
      objects={[]}
      synced
      busy={false}
      live
      cluster="kind-test"
      nsFiltered={false}
      nameOf={(p) => p.name}
      nsOf={(p) => p.ns}
      createdOf={() => now}
      labelsOf={(p) => p.labels}
      columns={[status]}
      sortKey="test/syntax"
      onOpen={() => {}}
      menuItems={() => []}
      onDelete={() => Promise.resolve()}
    />,
  );
}
const names = () => [...document.querySelectorAll("tbody tr[data-index] .td-name")].map((td) => td.textContent);
const filter = (q: string) => fireEvent.change(screen.getByRole("textbox", { name: "Filter pods" }), { target: { value: q } });

describe("filter syntax in a list", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("ns:, a column key, labels and negation narrow the list", () => {
    renderPods();
    filter("ns:shop");
    expect(names()).toEqual(["cart-1", "web-1"]);
    filter("ns:shop -status:crash");
    expect(names()).toEqual(["web-1"]);
    filter("label:app=etl");
    expect(names()).toEqual(["etl-1"]);
  });

  it("says what it understood under the field, and which keys this table knows", () => {
    renderPods();
    filter("ns:shop -label:app=web");
    expect(screen.getByText(/Filtering by/)).toHaveTextContent("Filtering by ns: shop · not label: app=web");
    expect(screen.getByRole("textbox", { name: "Filter pods" })).toHaveAccessibleDescription(
      "Type words, or key:value with ns, name, label, status. A leading - excludes.",
    );
  });
});
