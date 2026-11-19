import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Avatar } from "@kubebay/ui";

describe("Avatar", () => {
  it("shows the first letter of the name, upper-cased, and is hidden from screen readers", () => {
    const { container } = render(<Avatar name="redis" />);
    const el = container.querySelector(".kb-avatar");
    expect(el?.textContent).toBe("R");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("skips leading punctuation and falls back to a placeholder for an empty name", () => {
    expect(render(<Avatar name="-x" />).container.textContent).toBe("X");
    expect(render(<Avatar name="" />).container.textContent).toBe("?");
  });

  it("never renders an image", () => {
    expect(render(<Avatar name="redis" />).container.querySelector("img")).toBeNull();
  });
});
