/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { Property, PropertyList } from "@kubebay/ui";

describe("PropertyList", () => {
  // The drawer's label/value rows were <div>s of two <span>s, so a screen
  // reader heard a flat run of words. They are now a description list.
  it("renders label/value pairs as a description list (dl/dt/dd)", () => {
    const { container } = render(
      <PropertyList aria-label="Metadata">
        <Property label="Node">kind-dev-worker</Property>
        <Property label="Pod IP">10.244.2.1</Property>
      </PropertyList>,
    );
    const dl = container.querySelector("dl")!;
    expect(dl).toBeInTheDocument();
    expect(dl).toHaveAttribute("aria-label", "Metadata");
    const terms = within(dl).getAllByRole("term").map((t) => t.textContent);
    const defs = within(dl).getAllByRole("definition").map((d) => d.textContent);
    expect(terms).toEqual(["Node", "Pod IP"]);
    expect(defs).toEqual(["kind-dev-worker", "10.244.2.1"]);
    // Each dd follows its own dt.
    for (const dt of within(dl).getAllByRole("term")) expect(dt.nextElementSibling?.tagName).toBe("DD");
  });

  it("leaves out a property with no value, but keeps a zero", () => {
    render(
      <PropertyList>
        <Property label="Empty">{""}</Property>
        <Property label="Missing">{null}</Property>
        <Property label="Undefined">{undefined}</Property>
        <Property label="Restarts">{0}</Property>
      </PropertyList>,
    );
    expect(screen.queryByText("Empty")).toBeNull();
    expect(screen.queryByText("Missing")).toBeNull();
    expect(screen.queryByText("Undefined")).toBeNull();
    expect(screen.getByRole("term")).toHaveTextContent("Restarts");
    expect(screen.getByRole("definition")).toHaveTextContent("0");
  });

  it("can set the value, or the whole list, in monospace", () => {
    render(
      <>
        <PropertyList>
          <Property label="Image" mono>ghcr.io/acme/api:1</Property>
        </PropertyList>
        <PropertyList mono>
          <Property label="app.kubernetes.io/name">api</Property>
        </PropertyList>
      </>,
    );
    expect(screen.getByText("ghcr.io/acme/api:1")).toHaveClass("mono");
    expect(screen.getByText("Image")).not.toHaveClass("mono");
    expect(screen.getByText("app.kubernetes.io/name").closest("dl")).toHaveClass("mono");
  });

  it("lays rows out on a two-column grid with a separator hairline", () => {
    const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
    const rule = (sel: string) => new RegExp(`(^|\\n)${sel.replace(/[.>]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`).exec(css)?.[2] ?? "";
    expect(rule(".kb-props")).toMatch(/display:\s*grid/);
    expect(rule(".kb-props")).toMatch(/grid-template-columns:\s*minmax\(30%, max-content\) minmax\(0, 1fr\)/);
    const propRules = [...css.matchAll(/(^|\n)(\.kb-prop[^{]*)\{([^}]*)\}/g)].map((m) => m[3]!);
    expect(propRules.some((body) => /border-(top|bottom):\s*1px solid var\(--kb-separator\)/.test(body))).toBe(true);
    expect(rule(".kb-prop > dd")).toMatch(/margin:\s*0/);
  });
});
