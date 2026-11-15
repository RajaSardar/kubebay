/// <reference types="node" />
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { TableRow } from "@kubebay/ui";
import { ResourceListView, type ListColumn } from "../ResourceListView";

// #24: a row whose shown data changed flashes for about a second; under
// reduced motion it holds the tint instead of fading (docs/TABLE_FOLLOWUPS.md).

const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");

interface Job {
  name: string;
  rv: string;
  failed: number;
}
const now = new Date().toISOString();
const failed: ListColumn<Job> = { id: "Failed", header: "Failed", cell: (j) => j.failed, sortValue: (j) => j.failed };
const view = (rows: Job[]) => (
  <ResourceListView<Job>
    title="Jobs"
    label="Jobs"
    rows={rows}
    objects={[]}
    synced
    busy={false}
    live
    cluster="kind-test"
    nsFiltered={false}
    nameOf={(j) => j.name}
    nsOf={() => "shop"}
    createdOf={() => now}
    versionOf={(j) => j.rv}
    columns={[failed]}
    sortKey="test/changed"
    onOpen={() => {}}
    menuItems={() => []}
    onDelete={() => Promise.resolve()}
  />
);

describe("changed-row tint", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });

  it("TableRow changed marks the row", () => {
    render(
      <table>
        <tbody>
          <TableRow changed>
            <td>a</td>
          </TableRow>
        </tbody>
      </table>,
    );
    expect(screen.getByText("a").closest("tr")).toHaveAttribute("data-changed");
  });

  it("a resource list marks a row whose shown value changed, and only that row", () => {
    const r = render(view([{ name: "a", rv: "1", failed: 0 }, { name: "b", rv: "1", failed: 0 }]));
    r.rerender(view([{ name: "a", rv: "2", failed: 3 }, { name: "b", rv: "2", failed: 0 }]));
    expect(screen.getByText("a").closest("tr")).toHaveAttribute("data-changed");
    expect(screen.getByText("b").closest("tr")).not.toHaveAttribute("data-changed");
  });

  it("the tint fades over --kb-dur-flash, holds still under reduced motion, and covers pinned cells", () => {
    expect(css).toMatch(/tr\[data-changed\][^{]*\{[^}]*animation:\s*kb-row-changed var\(--kb-dur-flash\)/);
    expect(css).toMatch(/@keyframes kb-row-changed\s*\{[^}]*var\(--kb-row-changed\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^@]*tr\[data-changed\][^{]*\{[^}]*animation:\s*none[^}]*var\(--kb-row-changed\)/);
    expect(css).toMatch(/\.kb-table-pin-lead tbody tr\[data-changed\] > td\.col-select/);
  });
});
