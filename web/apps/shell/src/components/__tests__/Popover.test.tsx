import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Drawer, Popover } from "@kubebay/ui";

const trigger = () => screen.getByRole("button", { name: /Scale: 3/ });

function Fixture({ onOpenChange }: { onOpenChange?: (o: boolean) => void }) {
  return (
    <Popover label="Scale replicas" trigger="Scale: 3" onOpenChange={onOpenChange}>
      <input aria-label="Replicas" />
      <button type="button">Chip</button>
    </Popover>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("Popover", () => {
  it("is closed until the trigger is pressed, and wires aria-expanded and aria-controls", () => {
    render(<Fixture />);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger());
    const panel = screen.getByRole("dialog", { name: "Scale replicas" });
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", panel.id);
  });

  it("moves focus to the first field on open and back to the trigger on Escape", () => {
    render(<Fixture />);
    fireEvent.click(trigger());
    expect(screen.getByRole("textbox", { name: "Replicas" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Replicas" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("closes on a press outside, but not on a press inside, and does not steal focus", () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <Fixture />
      </>,
    );
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole("button", { name: "Chip" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can be disabled, and a disabled one never opens", () => {
    render(
      <Popover label="Scale replicas" trigger="Scale: 3" disabled>
        <input aria-label="Replicas" />
      </Popover>,
    );
    expect(trigger()).toBeDisabled();
    fireEvent.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reports open changes", () => {
    const spy = vi.fn();
    render(<Fixture onOpenChange={spy} />);
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(spy.mock.calls).toEqual([[true], [false]]);
  });

  it("opens leftward when the panel would run past the right edge of its container", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const panel = this.classList.contains("kb-popover-panel");
      return { left: panel ? 900 : 0, right: panel ? 1180 : 0, top: 0, bottom: 20, width: panel ? 280 : 0, height: 20, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    render(<Fixture />);
    fireEvent.click(trigger());
    expect(screen.getByRole("dialog")).toHaveClass("end");
  });

  it("stays left-aligned when it fits", () => {
    render(<Fixture />);
    fireEvent.click(trigger());
    expect(screen.getByRole("dialog")).not.toHaveClass("end");
  });
});

describe("Popover inside a Drawer", () => {
  function Host({ onClose }: { onClose: () => void }) {
    return (
      <div>
        <button type="button">Page behind</button>
        <Drawer title="web" onClose={onClose}>
          <Fixture />
        </Drawer>
      </div>
    );
  }

  it("Escape on a chip closes only the popover, then the next Escape closes the drawer", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.click(trigger());
    const chip = screen.getByRole("button", { name: "Chip" });
    chip.focus();
    fireEvent.keyDown(chip, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Scale replicas" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape in the field closes only the popover", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Replicas" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Scale replicas" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a press inside the popover leaves the drawer open; a press behind it closes both", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole("button", { name: "Chip" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Page behind" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Scale replicas" })).toBeNull();
  });
});
