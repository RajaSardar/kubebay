/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button, Drawer, Modal } from "@kubebay/ui";

describe("Drawer", () => {
  it("is a labelled side panel with a title, subtitle, leading slot and actions", () => {
    render(
      <Drawer title="api-7f9c" subtitle="default" leading={<span data-testid="dot" />} actions={<Button>Close</Button>} onClose={() => {}}>
        <p>Body</p>
      </Drawer>,
    );
    const panel = screen.getByRole("dialog", { name: "api-7f9c" });
    expect(panel.tagName).toBe("ASIDE");
    expect(panel).toHaveClass("drawer");
    expect(panel).toHaveAttribute("aria-modal", "false");
    expect(panel.querySelector(".drawer-head")).toContainElement(screen.getByTestId("dot"));
    expect(screen.getByText("api-7f9c")).toHaveClass("drawer-name");
    expect(screen.getByText("default")).toHaveClass("drawer-subtitle", "drawer-subtitle-mono");
    expect(screen.getByRole("button", { name: "Close" }).parentElement).toHaveClass("drawer-head-actions");
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("closes on Escape from inside the panel, but not while typing in a field, editor or terminal", () => {
    const onClose = vi.fn();
    render(
      <Drawer title="api" onClose={onClose}>
        <input aria-label="Filter" />
        <div className="xterm"><textarea aria-label="Terminal input" /></div>
        <button type="button">Focusable</button>
      </Drawer>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Filter" }), { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Terminal input" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Focusable" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes focus when it opens and gives it back when it closes", () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          {open && (
            <Drawer title="api" onClose={() => setOpen(false)} actions={<Button onClick={() => setOpen(false)}>Close</Button>}>
              body
            </Drawer>
          )}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "api" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(opener).toHaveFocus();
  });

  it("can set the subtitle in the proportional face", () => {
    render(<Drawer title="nginx" subtitle="A web server" subtitleMono={false} onClose={() => {}} />);
    expect(screen.getByText("A web server")).toHaveClass("drawer-subtitle");
    expect(screen.getByText("A web server")).not.toHaveClass("drawer-subtitle-mono");
  });

  it("is styled entirely by @kubebay/ui, not by classes the app happens to define", () => {
    const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
    const styled = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!));
    const { container } = render(
      <Drawer title="api" subtitle="default" leading={<i />} actions={<i />} onClose={() => {}} />,
    );
    const used = new Set([...container.querySelectorAll("[class]")].flatMap((el) => [...el.classList]));
    expect([...used].filter((c) => !styled.has(c))).toEqual([]);
  });
});

describe("Drawer embedded", () => {
  it("fills a full page as a labelled region that neither steals focus nor closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Drawer title="api" embedded onClose={onClose}>
        <button type="button">Inside</button>
      </Drawer>,
    );
    const region = screen.getByRole("region", { name: "api" });
    expect(region).toHaveClass("drawer", "embedded");
    expect(region).not.toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Inside" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Modal", () => {
  it("is a labelled modal dialog over a backdrop that closes it", () => {
    const onClose = vi.fn();
    render(
      <Modal label="Customize icon" onClose={onClose} className="icon-picker">
        <button type="button">Apply</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Customize icon" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("kb-modal", "icon-picker");
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".kb-modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and keeps Tab inside the dialog", () => {
    const onClose = vi.fn();
    render(
      <Modal label="Customize icon" onClose={onClose}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>,
    );
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    expect(first).toHaveFocus();
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders into document.body, so a filtered or transformed ancestor cannot trap its fixed position", () => {
    render(
      <div data-testid="host" style={{ backdropFilter: "blur(4px)" }}>
        <Modal label="Customize icon" onClose={() => {}}>
          <button type="button">Apply</button>
        </Modal>
      </div>,
    );
    const dialog = screen.getByRole("dialog", { name: "Customize icon" });
    expect(screen.getByTestId("host")).not.toContainElement(dialog);
    expect(dialog.parentElement).toBe(document.body);
  });

  it("can use a clear backdrop for popovers", () => {
    render(<Modal label="Pick" onClose={() => {}} backdrop="clear"><button type="button">x</button></Modal>);
    expect(document.querySelector(".kb-modal-backdrop")).toHaveClass("clear");
  });
});
