import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CopyableCommand } from "../CopyableCommand";

describe("CopyableCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the text under its label and copies it on click", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CopyableCommand label="Claude Code command" command="claude mcp add kubebay -- /kb mcp-stdio" />);
    expect(screen.getByLabelText("Claude Code command").textContent).toBe("claude mcp add kubebay -- /kb mcp-stdio");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("claude mcp add kubebay -- /kb mcp-stdio"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("still shows the text when the clipboard is unavailable", () => {
    vi.stubGlobal("navigator", {});
    render(<CopyableCommand command="kubectl port-forward svc/prometheus 9090" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByText("kubectl port-forward svc/prometheus 9090")).toBeInTheDocument();
  });
});
