import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkeletonLines, SkeletonTable, TableWrap } from "@kubebay/ui";

describe("SkeletonTable", () => {
  it("sketches the real table: its headers over shimmering rows, announced as loading", () => {
    render(<SkeletonTable headers={["Name", "Namespace", "Age"]} rows={4} label="Loading deployments…" leadingBlank />);
    const region = screen.getByRole("status", { name: "Loading deployments…" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["", "Name", "Namespace", "Age"]);
    const bodyRows = region.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(4);
    expect(bodyRows[0]!.querySelectorAll(".kb-skeleton")).toHaveLength(3);
  });

  it("varies bar widths down the rows so it reads as data, not stripes", () => {
    const { container } = render(<SkeletonTable headers={["Name"]} rows={3} />);
    const widths = [...container.querySelectorAll("tbody .kb-skeleton")].map((s) => (s as HTMLElement).style.width);
    expect(new Set(widths).size).toBeGreaterThan(1);
  });
});

describe("SkeletonLines", () => {
  it("stands in for a paragraph or a key/value list while it loads", () => {
    render(<SkeletonLines lines={3} label="Loading summary…" />);
    const s = screen.getByRole("status", { name: "Loading summary…" });
    expect(s.querySelectorAll(".kb-skeleton")).toHaveLength(3);
  });
});

describe("TableWrap busy", () => {
  it("shows a thin progress bar while rows already on screen are refreshed", () => {
    const { container, rerender } = render(<TableWrap busy><table /></TableWrap>);
    const bar = container.querySelector(".kb-table-progress");
    expect(bar).not.toBeNull();
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
    rerender(<TableWrap><table /></TableWrap>);
    expect(container.querySelector(".kb-table-progress")).toBeNull();
    expect(container.firstElementChild).not.toHaveAttribute("aria-busy");
  });
});

describe("skeleton bars in table cells", () => {
  // jsdom has no layout, so this reads the package stylesheet: a bar wider than a
  // narrow column (Age is 60px) must shrink to the cell, or the cell's ellipsis
  // draws a stray "…" after it.
  it("never overflow their cell", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
    const rule = /td\s*>\s*\.kb-skeleton\s*\{[^}]*max-width:\s*100%/;
    expect(css).toMatch(rule);
  });
});
