import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExtensionsCard } from "../ExtensionsCard";
import type { ExtensionsFile } from "../../lib/api";

// KB-13: Settings shows where the extensions file is, what loaded, what's
// wrong with the rest, and whether command actions can run.

let file: ExtensionsFile;
const get = vi.fn(async () => file);
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, extensionsApi: { get: () => get() } };
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ExtensionsCard />
    </QueryClientProvider>,
  );
}

describe("ExtensionsCard", () => {
  beforeEach(() => {
    get.mockClear();
    file = {
      path: "/Users/raja/.kubebay/extensions.yaml",
      exists: true,
      columns: [{ resource: "pods", header: "Host IP", jsonPath: ".status.hostIP" }],
      actions: [
        { resource: "pods", label: "Open in Grafana", url: "https://g.example/{{name}}" },
        { resource: "deployments", label: "Tail with stern", run: "stern {{name}}" },
      ],
      errors: ['action 3 ("Bad"): set exactly one of url or run'],
      commands: { available: true, shell: "zsh" },
    };
  });

  it("lists what loaded and what's wrong with the file", async () => {
    renderCard();
    expect(await screen.findByText("/Users/raja/.kubebay/extensions.yaml")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Host IP")).toBeInTheDocument();
    expect(within(table).getByText("Open in Grafana")).toBeInTheDocument();
    expect(within(table).getByText("stern {{name}}")).toBeInTheDocument();
    expect(screen.getByText('action 3 ("Bad"): set exactly one of url or run')).toBeInTheDocument();
    expect(screen.getByText(/typed into the local shell \(zsh\)/)).toBeInTheDocument();
  });

  it("reads the file again on Reload", async () => {
    renderCard();
    await screen.findByText("Host IP");
    file = { ...file, errors: [] };
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.queryByText(/set exactly one of url or run/)).toBeNull());
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("says why command actions are hidden", async () => {
    file.commands = { available: false, reason: "command actions run in the local shell, and this engine wasn't started with --local-shell" };
    renderCard();
    expect(await screen.findByText(/hidden: command actions run in the local shell/)).toBeInTheDocument();
  });

  it("shows how to start when there's no file", async () => {
    file = { ...file, exists: false, columns: [], actions: [], errors: [] };
    renderCard();
    expect(await screen.findByText(/No extensions file yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says when extensions are off in this deployment", async () => {
    file = { path: "", exists: false, columns: [], actions: [], errors: [], disabled: "extensions come from a file on the engine's machine, so they're off in in-cluster mode", commands: { available: false } };
    renderCard();
    expect(await screen.findByText(/off in in-cluster mode/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });
});
