import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ResourceTable from "../ResourceTable";
import type { ExtensionsFile } from "../../lib/api";

// KB-13: columns and row actions from ~/.kubebay/extensions.yaml on the
// /r/:kind tables.

const now = new Date().toISOString();
const services = [
  { metadata: { name: "pay", namespace: "shop", creationTimestamp: now, labels: { team: "payments" } }, spec: { type: "ClusterIP" } },
  { metadata: { name: "web", namespace: "shop", creationTimestamp: now }, spec: { type: "LoadBalancer" } },
];

const streamCalls: { gvr: string; mode?: string }[] = [];
vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [{ id: "kind-test", context: "dev-1" }], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return {
    ...actual,
    useResourceStream: (_c: string, gvr: string, opts?: { mode?: string }) => {
      streamCalls.push({ gvr, mode: opts?.mode });
      const rows = gvr === "v1/services" ? services : gvr === "v1/secrets" ? [{ metadata: { name: "db", namespace: "shop", creationTimestamp: now } }] : [];
      return { rows, synced: true, connected: true };
    },
  };
});

let file: ExtensionsFile;
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, extensionsApi: { get: vi.fn(async () => file) } };
});

function base(): ExtensionsFile {
  return { path: "/h/.kubebay/extensions.yaml", exists: true, columns: [], actions: [], errors: [], commands: { available: true, shell: "zsh" } };
}

function Where() {
  const loc = useLocation();
  return <pre data-testid="terminal-state">{JSON.stringify(loc.state)}</pre>;
}

function renderTable(kind = "services") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/r/${kind}`]}>
        <Routes>
          <Route path="/r/:kind" element={<ResourceTable />} />
          <Route path="/terminal" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const lastStream = (gvr: string) => streamCalls.filter((c) => c.gvr === gvr).at(-1);
const names = () => [...document.querySelectorAll("tbody tr[data-index] .td-name")].map((td) => td.textContent);
async function openMenu(row: string) {
  const tr = (await screen.findByText(row)).closest("tr")!;
  fireEvent.click(within(tr).getByRole("button", { name: `Actions for ${row}` }));
}

describe("extensions on resource tables", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => {
    localStorage.clear();
    streamCalls.length = 0;
    file = base();
  });
  afterEach(() => vi.restoreAllMocks());

  it("adds a column that shows, filters and sorts", async () => {
    file.columns = [{ resource: "services", header: "Team", jsonPath: ".metadata.labels.team" }];
    renderTable();
    await screen.findByRole("columnheader", { name: "Team" });
    expect(screen.getByText("payments")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /^Filter/ }), { target: { value: "team:payments" } });
    expect(names()).toEqual(["pay"]);
  });

  it("loads whole objects only when a column reads beyond metadata", async () => {
    file.columns = [{ resource: "services", header: "Team", jsonPath: ".metadata.labels.team" }];
    const first = renderTable();
    await screen.findByRole("columnheader", { name: "Team" });
    expect(lastStream("v1/services")?.mode).toBe("metadata");
    first.unmount();

    file.columns = [{ resource: "services", header: "Exposed as", jsonPath: ".spec.type" }];
    renderTable();
    await screen.findByRole("columnheader", { name: "Exposed as" });
    expect(lastStream("v1/services")?.mode).toBe("full");
    // The built-in Type column and the extension column both show it.
    expect(screen.getAllByText("LoadBalancer")).toHaveLength(2);
  });

  it("never loads Secret data for a column", async () => {
    file.columns = [{ resource: "secrets", header: "Password", jsonPath: ".data.password" }];
    renderTable("secrets");
    await screen.findByRole("columnheader", { name: "Password" });
    const secretStreams = streamCalls.filter((c) => c.gvr === "v1/secrets");
    expect(secretStreams.length).toBeGreaterThan(0);
    expect(secretStreams.every((c) => c.mode === "metadata")).toBe(true);
  });

  it("opens a URL action with the row's values encoded", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    file.actions = [{ resource: "services", label: "Open in Grafana", url: "https://g.example/d?ns={{namespace}}&svc={{name}}&ctx={{context}}" }];
    renderTable();
    await openMenu("pay");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open in Grafana" }));
    expect(open).toHaveBeenCalledWith("https://g.example/d?ns=shop&svc=pay&ctx=dev-1", "_blank", "noopener,noreferrer");
  });

  it("takes a command action to the terminal, quoted, to be run by hand", async () => {
    file.actions = [{ resource: "services", label: "Describe", run: "kubectl -n {{namespace}} describe svc {{name}}" }];
    renderTable();
    await openMenu("pay");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Describe" }));
    const state = JSON.parse((await screen.findByTestId("terminal-state")).textContent ?? "null");
    expect(state).toEqual({ prefill: { cluster: "kind-test", command: "kubectl -n 'shop' describe svc 'pay'", label: "Describe" } });
  });

  it("disables an action whose value the row lacks, and says why", async () => {
    file.actions = [{ resource: "services", label: "Team board", url: "https://t.example/{{label:team}}" }];
    renderTable();
    await openMenu("web");
    const item = await screen.findByRole("menuitem", { name: "Team board" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleDescription("It has no label team.");
  });

  it("leaves command actions out without a local shell, and actions for other contexts", async () => {
    file.commands = { available: false, reason: "no local shell" };
    file.actions = [
      { resource: "services", label: "Describe", run: "kubectl describe svc {{name}}" },
      { resource: "services", label: "Prod board", url: "https://p.example/{{name}}", contexts: ["prod-*"] },
      { resource: "services", label: "Dev board", url: "https://d.example/{{name}}", contexts: ["dev-*"] },
    ];
    renderTable();
    await openMenu("pay");
    await screen.findByRole("menuitem", { name: "Dev board" });
    expect(screen.queryByRole("menuitem", { name: "Describe" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Prod board" })).toBeNull();
  });
});
