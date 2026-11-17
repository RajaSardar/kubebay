import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WhatsNew } from "../WhatsNew";
import { api } from "../../lib/api";
import type { WhatsNewRelease } from "../../lib/whatsNew";

vi.mock("../../lib/api", () => ({ api: { version: vi.fn() } }));

const releases: WhatsNewRelease[] = [
  { version: "unreleased", date: "", sections: [{ heading: "Added", items: [{ title: "Not shipped", summary: "" }] }] },
  {
    version: "0.7.3",
    date: "2026-11-17",
    sections: [
      { heading: "Added", items: [{ title: "Dock terminal", summary: "The shell lives under every page." }, { title: "Coloured logs", summary: "Levels get colours." }] },
      { heading: "Fixed", items: [{ title: "Self update", summary: "The updater key is read from a secret." }] },
    ],
  },
  { version: "0.7.2", date: "2026-11-14", sections: [{ heading: "Added", items: [{ title: "Signing key", summary: "Releases carry it." }] }] },
  { version: "0.7.1", date: "2026-11-10", sections: [{ heading: "Changed", items: [{ title: "Old thing", summary: "Was changed." }] }] },
];

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WhatsNew releases={releases} />
    </QueryClientProvider>,
  );
}
const engineIs = (version: string) => vi.mocked(api.version).mockResolvedValue({ version });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.version).mockReset();
});

describe("What's new after an update", () => {
  it("lists the changes grouped by section, each with its title in bold and its summary", async () => {
    localStorage.setItem("kb.lastSeenVersion", "0.7.2");
    engineIs("v0.7.3");
    renderIt();
    const dialog = await screen.findByRole("dialog", { name: "What's new in Kubebay v0.7.3" });
    expect(within(dialog).getByRole("heading", { name: "Added" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Fixed" })).toBeInTheDocument();
    const items = within(dialog).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Dock terminal");
    expect(items[0]).toHaveTextContent("The shell lives under every page.");
    expect(within(items[0]!).getByText("Dock terminal").tagName).toBe("STRONG");
    expect(within(dialog).queryByText("Not shipped")).not.toBeInTheDocument();
  });

  it("shows every release the user skipped, newest first", async () => {
    localStorage.setItem("kb.lastSeenVersion", "0.7.0");
    engineIs("0.7.3");
    renderIt();
    const dialog = await screen.findByRole("dialog", { name: "What's new in Kubebay v0.7.1 to v0.7.3" });
    const text = dialog.textContent ?? "";
    expect(text.indexOf("Dock terminal")).toBeLessThan(text.indexOf("Signing key"));
    expect(text.indexOf("Signing key")).toBeLessThan(text.indexOf("Old thing"));
    expect(within(dialog).getByRole("heading", { name: "v0.7.2" })).toBeInTheDocument();
  });

  it("links to the full release notes in a new tab, safely", async () => {
    localStorage.setItem("kb.lastSeenVersion", "0.7.2");
    engineIs("v0.7.3");
    renderIt();
    const link = await screen.findByRole("link", { name: "Full release notes" });
    expect(link).toHaveAttribute("href", "https://github.com/RajaSardar/kubebay/releases/tag/v0.7.3");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("Got it closes it and remembers the current version", async () => {
    localStorage.setItem("kb.lastSeenVersion", "0.7.2");
    engineIs("v0.7.3");
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem("kb.lastSeenVersion")).toBe("v0.7.3");
  });

  it("Escape closes it and remembers the current version", async () => {
    localStorage.setItem("kb.lastSeenVersion", "0.7.2");
    engineIs("0.7.3");
    renderIt();
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem("kb.lastSeenVersion")).toBe("0.7.3");
  });

  it("keeps a long list scrollable inside the dialog, with Got it outside the scroll", async () => {
    localStorage.setItem("kb.lastSeenVersion", "0.7.0");
    engineIs("0.7.3");
    renderIt();
    const dialog = await screen.findByRole("dialog");
    const scroller = within(dialog).getByTestId("whatsnew-scroll");
    expect(scroller.style.overflowY).toBe("auto");
    expect(scroller).not.toContainElement(within(dialog).getByRole("button", { name: "Got it" }));
  });
});

describe("when it stays away", () => {
  it("on the first ever run it shows nothing and records the version", async () => {
    engineIs("v0.7.3");
    renderIt();
    await waitFor(() => expect(localStorage.getItem("kb.lastSeenVersion")).toBe("v0.7.3"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("with the same version it shows nothing", async () => {
    localStorage.setItem("kb.lastSeenVersion", "0.7.3");
    engineIs("v0.7.3");
    renderIt();
    await waitFor(() => expect(api.version).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("on a dev build it shows nothing and records nothing", async () => {
    localStorage.setItem("kb.lastSeenVersion", "0.7.1");
    engineIs("dev");
    renderIt();
    await waitFor(() => expect(api.version).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem("kb.lastSeenVersion")).toBe("0.7.1");
  });

  it("when the engine can't be reached it shows nothing", async () => {
    localStorage.setItem("kb.lastSeenVersion", "0.7.1");
    vi.mocked(api.version).mockRejectedValue(new Error("down"));
    renderIt();
    await waitFor(() => expect(api.version).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("records a new version the changelog has nothing about, without a window", async () => {
    localStorage.setItem("kb.lastSeenVersion", "0.7.3");
    engineIs("0.7.4");
    renderIt();
    await waitFor(() => expect(localStorage.getItem("kb.lastSeenVersion")).toBe("0.7.4"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
