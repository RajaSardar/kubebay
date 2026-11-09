import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CopyButton, Drawer } from "@kubebay/ui";

// Root backlog #21: a copy-name button for every kind. One control in the
// design system, used in every drawer's head and on every list row.

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(() => vi.useRealTimers());

// The page's one polite live region, shared by every copy button.
const announcer = () => document.querySelector("[data-kb-announcer]");

describe("CopyButton", () => {
  it("shares one polite live region however many buttons there are", () => {
    render(
      <>
        <CopyButton text="a" label="Copy a" />
        <CopyButton text="b" label="Copy b" />
      </>,
    );
    expect(document.querySelectorAll("[data-kb-announcer]")).toHaveLength(1);
    expect(announcer()).toHaveAttribute("aria-live", "polite");
  });

  it("copies its text, says so, and goes back after a moment", async () => {
    vi.useFakeTimers();
    render(<CopyButton text="web-7f9c" label="Copy name" />);
    const button = screen.getByRole("button", { name: "Copy name" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledWith("web-7f9c");
    expect(announcer()).toHaveTextContent("Copied");
    expect(button).toHaveAttribute("title", "Copied");
    expect(button).toHaveClass("copied");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(announcer()).toHaveTextContent("");
    expect(button).toHaveAttribute("title", "Copy name");
  });

  it("doesn't pass the press on to a clickable row around it", async () => {
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <CopyButton text="web" label="Copy name" />
      </div>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy name" }));
    });
    expect(onRow).not.toHaveBeenCalled();
  });

  it("says nothing when the clipboard refuses", async () => {
    writeText.mockImplementation(() => Promise.reject(new Error("denied")));
    render(<CopyButton text="web" label="Copy name" />);
    const button = screen.getByRole("button", { name: "Copy name" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button).toHaveAttribute("title", "Copy name");
    expect(button).not.toHaveClass("copied");
  });
});

describe("Drawer copyName", () => {
  it("puts a Copy name button beside the title, outside it, so the panel's name stays the title", async () => {
    render(<Drawer title="api-7f9c" copyName="api-7f9c" onClose={() => {}} />);
    const panel = screen.getByRole("dialog", { name: "api-7f9c" });
    const button = screen.getByRole("button", { name: "Copy name" });
    expect(panel.querySelector(".drawer-name")).not.toContainElement(button);
    expect(panel.querySelector(".drawer-title")).toContainElement(button);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledWith("api-7f9c");
  });

  it("has no copy button without copyName", () => {
    render(<Drawer title="Audit entry" onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Copy name" })).toBeNull();
  });
});
