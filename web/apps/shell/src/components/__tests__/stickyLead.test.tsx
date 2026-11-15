/// <reference types="node" />
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { SortHeader, Table } from "@kubebay/ui";
import { ResourceListView } from "../ResourceListView";

// #27: on a wide table the select box and Name stay put while the rest
// scrolls sideways (docs/TABLE_FOLLOWUPS.md). jsdom has no layout, so the
// stylesheet contract is checked as text and the scrolling in a browser.

const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
const rule = (selector: string) => {
  const i = css.indexOf(selector + " {");
  expect(i, `rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("}", i));
};

describe("pinned lead columns", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });

  it("Table pinLead and SortHeader pinned mark the table and the Name header", () => {
    render(
      <Table pinLead>
        <thead>
          <tr>
            <SortHeader label="Name" pinned />
            <SortHeader label="Age" />
          </tr>
        </thead>
      </Table>,
    );
    expect(screen.getByRole("table")).toHaveClass("kb-table", "kb-table-pin-lead");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass("th-pin");
    expect(screen.getByRole("columnheader", { name: "Age" })).not.toHaveClass("th-pin");
  });

  it("every resource list pins its select box and Name", () => {
    const now = new Date().toISOString();
    render(
      <ResourceListView
        title="Jobs"
        label="Jobs"
        rows={[{ name: "a" }]}
        objects={[]}
        synced
        busy={false}
        live
        cluster="kind-test"
        nsFiltered={false}
        nameOf={(r) => r.name}
        nsOf={() => "shop"}
        createdOf={() => now}
        columns={[]}
        sortKey="test/pin"
        onOpen={() => {}}
        menuItems={() => []}
        onDelete={() => Promise.resolve()}
      />,
    );
    expect(screen.getByRole("table")).toHaveClass("kb-table-pin-lead");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass("th-pin");
  });

  it("the stylesheet sticks them, paints them opaque, and keeps the accent bar and dimming", () => {
    expect(rule(".kb-table-pin-lead .col-select")).toMatch(/position:\s*sticky[\s\S]*left:\s*0/);
    expect(rule(".kb-table-pin-lead .th-pin,\n.kb-table-pin-lead td.td-name")).toMatch(/position:\s*sticky[\s\S]*left:\s*var\(--kb-pin-select-w\)/);
    // Opaque: a solid surface under any translucent state tint.
    expect(rule(".kb-table-pin-lead tbody td.col-select,\n.kb-table-pin-lead tbody td.td-name")).toMatch(/background-color:\s*var\(--kb-bg-surface\)/);
    expect(css).toMatch(/\.kb-table-pin-lead tbody tr\.selected > td\.col-select[\s\S]*?box-shadow:\s*inset 3px 0 0 var\(--kb-accent\)/);
    // Terminating rows fade their contents, not the pinned cells' backgrounds.
    expect(css).toMatch(/\.kb-table-pin-lead tbody tr\[data-terminating\][^{]*\{[^}]*opacity:\s*1/);
  });
});
