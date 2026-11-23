/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { NavItem } from "@kubebay/ui";

describe("NavItem in the full-bleed sidebar", () => {
  // Nav items run edge to edge on the chrome sidebar. The active one is a band
  // in the selected shade with the 3px accent bar, and screen readers hear it
  // as the current page.
  const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
  const bar = /inset 3px 0 0 var\(--kb-accent\)/;
  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  });
  afterEach(() => style.remove());

  it("the active item is the current page and shows its bar; the others show none", () => {
    render(
      <nav>
        <NavItem label="Pods" href="#/pods" active />
        <NavItem label="Nodes" href="#/nodes" />
      </nav>,
    );
    const pods = screen.getByRole("link", { name: "Pods" });
    const nodes = screen.getByRole("link", { name: "Nodes" });
    expect(pods).toHaveAttribute("aria-current", "page");
    expect(nodes).not.toHaveAttribute("aria-current");
    expect(getComputedStyle(pods).boxShadow).toMatch(bar);
    expect(getComputedStyle(nodes).boxShadow).not.toMatch(bar);
  });

  it("the band is flush: no margin, square, and the label keeps the regular weight", () => {
    render(<NavItem label="Pods" href="#/pods" active />);
    const pods = getComputedStyle(screen.getByRole("link", { name: "Pods" }));
    for (const side of ["Left", "Right"] as const) expect(["", "0", "0px"]).toContain(pods[`margin${side}`]);
    expect(pods.borderRadius).toBe("var(--kb-radius-tile)");
    expect(pods.fontWeight).toBe("500");
  });

  it("an action item is pressed while open and shows the bar too", () => {
    render(<NavItem label="Terminal" onClick={() => {}} active />);
    const term = screen.getByRole("button", { name: "Terminal" });
    expect(term).toHaveAttribute("aria-pressed", "true");
    expect(getComputedStyle(term).boxShadow).toMatch(bar);
  });
});
