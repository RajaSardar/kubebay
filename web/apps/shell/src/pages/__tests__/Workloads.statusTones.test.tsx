import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Workloads from "../Workloads";

// Backlog #35: each pod status reads as its own colour in the Pods table, and
// the word stays beside it.

const now = new Date().toISOString();
const base = (name: string, status: Record<string, unknown>, meta: Record<string, unknown> = {}) => ({
  metadata: { name, namespace: "shop", creationTimestamp: now, ...meta },
  spec: { nodeName: "n1", containers: [{ name: "app" }] },
  status,
});
const cs = (ready: boolean, state: Record<string, unknown>) => ({ containerStatuses: [{ name: "app", ready, restartCount: 0, state }] });
const rows = [
  base("p-running", { phase: "Running", ...cs(true, { running: {} }) }),
  base("p-pending", { phase: "Pending" }),
  base("p-creating", { phase: "Pending", ...cs(false, { waiting: { reason: "ContainerCreating" } }) }),
  base("p-crash", { phase: "Running", ...cs(false, { waiting: { reason: "CrashLoopBackOff" } }) }),
  base("p-done", { phase: "Succeeded" }),
  base("p-failed", { phase: "Failed" }),
  base("p-term", { phase: "Running", ...cs(true, { running: {} }) }, { deletionTimestamp: now }),
  base("p-unknown", { phase: "Unknown" }),
];

vi.mock("../../App", () => ({
  useActiveCluster: () => ({ active: "kind-test", setActive: vi.fn(), switching: false }),
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, clusters: vi.fn(async () => []), podMetrics: vi.fn(async () => []) } };
});
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return { ...actual, useResourceStream: () => ({ rows, synced: true, connected: true }) };
});

describe("Pods status tones", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });

  it("gives each status word its own tone class", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/workloads"]}>
          <Workloads />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const pill = (name: string) => screen.getByText(name).closest("tr")!.querySelector("[class^='status-']") as HTMLElement;
    const expectPill = (name: string, word: string, cls: string) => {
      const p = pill(name);
      expect(p.textContent).toBe(word);
      expect(p).toHaveClass(cls);
    };
    expectPill("p-running", "Running", "status-ok");
    expectPill("p-pending", "Pending", "status-pending");
    expectPill("p-creating", "Pending", "status-pending");
    expectPill("p-crash", "CrashLoopBackOff", "status-err");
    expectPill("p-done", "Succeeded", "status-done");
    expectPill("p-failed", "Failed", "status-err");
    expectPill("p-term", "Terminating", "status-terminating");
    expectPill("p-unknown", "Unknown", "status-terminated");
  });
});
