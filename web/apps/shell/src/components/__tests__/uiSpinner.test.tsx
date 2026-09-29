/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { Spinner } from "@kubebay/ui";
import { IconLoader } from "@kubebay/ui/src/icons";
import { PageLoader } from "../PageLoader";

const stylesCss = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");

describe("IconLoader", () => {
  it("is a helm-wheel stroke icon drawn in currentColor, like the rest of the set", () => {
    const { container } = render(<IconLoader size={20} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // A rim, a hub and six spokes.
    expect(svg.querySelectorAll("circle")).toHaveLength(2);
    expect(svg.querySelectorAll("path, line")).toHaveLength(1);
  });
});

describe("Spinner", () => {
  it("announces itself as a busy status with a label", () => {
    render(<Spinner />);
    const s = screen.getByRole("status", { name: "Loading…" });
    expect(s).toHaveClass("kb-spinner");
    expect(s).toHaveAttribute("aria-busy", "true");
    expect(s.querySelector("svg")).not.toBeNull();
  });

  it("takes a custom label and size", () => {
    render(<Spinner label="Connecting to prod" size={28} />);
    const s = screen.getByRole("status", { name: "Connecting to prod" });
    expect(s.querySelector("svg")).toHaveAttribute("width", "28");
  });

  it("can be decorative when the text beside it already says what is loading", () => {
    const { container } = render(<Spinner label={null} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector(".kb-spinner")).toHaveAttribute("aria-hidden", "true");
  });

  it("spins with a stylesheet animation that reduced motion can stop", () => {
    const rule = /\.kb-spinner svg\s*\{([^}]*)\}/.exec(stylesCss)?.[1] ?? "";
    expect(rule).toMatch(/animation:\s*kb-spin\b/);
    expect(stylesCss).toMatch(/@keyframes kb-spin\b/);
  });
});

describe("PageLoader", () => {
  it("uses the Spinner and shows its message", () => {
    render(<PageLoader message="Loading RBAC data…" />);
    expect(screen.getByRole("status", { name: "Loading RBAC data…" })).toHaveClass("kb-spinner");
    expect(screen.getByText("Loading RBAC data…")).toBeInTheDocument();
  });
});
