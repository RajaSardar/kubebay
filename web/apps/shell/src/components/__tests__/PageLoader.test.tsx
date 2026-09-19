import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageLoader } from "../PageLoader";

describe("PageLoader", () => {
  it("renders the spinner element", () => {
    const { container } = render(<PageLoader />);
    expect(container.querySelector(".page-loader-spinner")).toBeTruthy();
  });

  it("renders inside a .page-loader wrapper", () => {
    const { container } = render(<PageLoader />);
    expect(container.querySelector(".page-loader")).toBeTruthy();
  });

  it("renders a default message when none provided", () => {
    render(<PageLoader />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders a custom message when provided", () => {
    render(<PageLoader message="Connecting to event stream…" />);
    expect(screen.getByText("Connecting to event stream…")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("has aria-busy on the root for accessibility", () => {
    const { container } = render(<PageLoader />);
    const root = container.querySelector(".page-loader");
    expect(root?.getAttribute("aria-busy")).toBe("true");
  });

  it("accepts an optional className prop", () => {
    const { container } = render(<PageLoader className="my-custom" />);
    expect(container.querySelector(".page-loader.my-custom")).toBeTruthy();
  });
});
