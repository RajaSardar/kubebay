import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { HelpTip, PageHeader } from "@kubebay/ui";

// Root backlog #18 (docs/HELP_TIPS_RESEARCH.md): an info button beside a
// feature's title that explains it. A toggletip, not a tooltip: it opens on
// click, Enter or Space (so keyboard and touch reach it, not just a hovering
// mouse), holds a link, and stays until dismissed.

function tip() {
  return render(
    <div>
      <HelpTip label="About Helm">
        <p>Every Helm release on the cluster.</p>
        <a href="https://kubebay.sardar.dev/docs/helm/">Learn more</a>
      </HelpTip>
      <button type="button">Elsewhere</button>
    </div>,
  );
}

describe("HelpTip", () => {
  it("is a collapsed button named by its label until pressed", () => {
    tip();
    const button = screen.getByRole("button", { name: "About Helm" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Every Helm release on the cluster.")).toBeNull();
  });

  it("opens on a press, says what it controls, and closes on a second press", () => {
    tip();
    const button = screen.getByRole("button", { name: "About Helm" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("dialog", { name: "About Helm" });
    expect(button).toHaveAttribute("aria-controls", panel.id);
    expect(within(panel).getByText("Every Helm release on the cluster.")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Learn more" })).toHaveAttribute("href", "https://kubebay.sardar.dev/docs/helm/");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and hands focus back to its button", () => {
    tip();
    const button = screen.getByRole("button", { name: "About Helm" });
    fireEvent.click(button);
    const link = screen.getByRole("link", { name: "Learn more" });
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("closes on Escape even when the click left focus elsewhere, as WebKit does", () => {
    tip();
    fireEvent.click(screen.getByRole("button", { name: "About Helm" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a press elsewhere, but not on one inside the panel", () => {
    tip();
    fireEvent.click(screen.getByRole("button", { name: "About Helm" }));
    fireEvent.mouseDown(screen.getByText("Every Helm release on the cluster."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens toward the page when its button sits at the right edge", () => {
    render(<HelpTip label="About Terminal" align="end">A shell on your machine.</HelpTip>);
    fireEvent.click(screen.getByRole("button", { name: "About Terminal" }));
    expect(screen.getByRole("dialog")).toHaveClass("kb-helptip-panel", "end");
  });

  it("puts the panel right after its button, so Tab reaches the link next", () => {
    tip();
    const button = screen.getByRole("button", { name: "About Helm" });
    fireEvent.click(button);
    expect(button.nextElementSibling).toBe(screen.getByRole("dialog"));
  });
});

describe("PageHeader help", () => {
  it("sits beside the title, outside the heading, so the heading's name stays the title", () => {
    render(<PageHeader title="Helm releases" help={<HelpTip label="About Helm">Every release.</HelpTip>} />);
    const heading = screen.getByRole("heading", { name: "Helm releases" });
    const button = screen.getByRole("button", { name: "About Helm" });
    expect(heading).not.toContainElement(button);
    expect(heading.parentElement).toContainElement(button);
    fireEvent.click(button);
    expect(heading).not.toContainElement(screen.getByRole("dialog"));
  });
});
