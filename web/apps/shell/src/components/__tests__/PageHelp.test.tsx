import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CardHelp, PageHelp } from "../PageHelp";

// Root backlog #18: a page's ⓘ says what it is and how it works, then links
// to its page in the user manual.

describe("PageHelp", () => {
  it("explains the page and links to its page in the manual, in a new window", () => {
    render(<PageHelp route="/helm" />);
    fireEvent.click(screen.getByRole("button", { name: "About Helm" }));
    const panel = screen.getByRole("dialog", { name: "About Helm" });
    expect(within(panel).getByText(/Every Helm release/)).toBeInTheDocument();
    expect(within(panel).getByText(/release records the helm CLI does/)).toBeInTheDocument();
    const link = within(panel).getByRole("link", { name: /Learn more/ });
    expect(link).toHaveAttribute("href", "https://kubebay.sardar.dev/docs/helm/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("renders nothing for a route it has no help for", () => {
    const { container } = render(<PageHelp route="/nowhere" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CardHelp", () => {
  it("explains an insight card and links to its heading in the manual", () => {
    render(<CardHelp card="node-consolidation" />);
    fireEvent.click(screen.getByRole("button", { name: "About Node consolidation" }));
    const panel = screen.getByRole("dialog", { name: "About Node consolidation" });
    expect(within(panel).getByRole("link", { name: /Learn more/ })).toHaveAttribute("href", "https://kubebay.sardar.dev/docs/cost-waste/#node-consolidation");
  });
});
