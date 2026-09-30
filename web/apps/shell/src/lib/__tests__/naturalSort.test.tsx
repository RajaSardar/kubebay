import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { compareValues } from "../tableUx";
import ResourceTable from "../../pages/ResourceTable";

describe("compareValues", () => {
  it("compares numbers as numbers", () => {
    expect([10, 9, 100].sort(compareValues)).toEqual([9, 10, 100]);
  });

  it("compares text naturally: digits inside names count as numbers", () => {
    expect(["pod-10", "pod-9", "pod-1"].sort(compareValues)).toEqual(["pod-1", "pod-9", "pod-10"]);
    // Resource tables hold counts as text ("10", "9"): they sort as numbers too.
    expect(["10", "9", "100"].sort(compareValues)).toEqual(["9", "10", "100"]);
  });

  it("ignores case, so Web and web sit together", () => {
    expect(compareValues("Web", "web")).toBe(0);
  });
});

// A resource table sorted its columns as text, so a Job with 10 failures sorted
// below one with 9 ("10" < "9"), and so did Restarts, node Pods and event Count.
const jobs = [9, 10, 2].map((failed, i) => ({
  metadata: { name: `job-${i}`, namespace: "shop", creationTimestamp: new Date().toISOString() },
  spec: { completions: 1 },
  status: { failed, succeeded: 0 },
}));

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return { ...actual, useResourceStream: () => ({ rows: jobs, synced: true, connected: true }) };
});

describe("resource table sort", () => {
  beforeAll(() => {
    // jsdom has no layout: give the virtualised table a real viewport.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("sorts a count column by number, not as text", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/r/jobs"]}>
          <Routes>
            <Route path="/r/:kind" element={<ResourceTable />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    const failedIdx = headers.findIndex((h) => /^Failed/.test(h.textContent ?? ""));
    fireEvent.click(headers[failedIdx]!);
    const failed = [...table.querySelectorAll("tbody tr[data-index]")].map((tr) => tr.children[failedIdx]!.textContent?.trim());
    expect(failed).toEqual(["2", "9", "10"]);
  });
});
