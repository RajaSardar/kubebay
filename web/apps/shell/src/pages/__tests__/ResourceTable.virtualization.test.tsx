import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ResourceTable from "../ResourceTable";

// Bug report (Raja): "all the tabs i am not able to see all, when i am
// scrolling only able to see few and not loading all — in service nav not
// able to see all services in scroll also not able to scroll — same with
// keda scale objects — same with deployments — same with replica sets —
// i think this is happening with almost all the list navs — only thing i
// can see working is pods."
//
// Root cause: ResourceTable windows rows with @tanstack/react-virtual and
// fakes the spacing for off-screen rows by setting `paddingTop`/
// `paddingBottom` directly on the <tbody> element. Real browsers do not
// apply padding (or margin) to table row groups / rows — only to cells —
// so that spacing never actually grows the scrollable area. The result:
// the scroll container's real scrollHeight is clamped to the height of the
// handful of rows the virtualizer actually mounted (its rendered window +
// overscan), so the user can only scroll a few rows deep no matter how many
// rows the list has. Pods aren't affected because Workloads.tsx renders its
// pod table without virtualization (every row is mounted directly).
//
// jsdom doesn't run a real layout/rendering engine, so it can't reproduce
// "the browser ignores this style" directly — but it does faithfully record
// which inline styles were set on which elements, so we can pin the actual
// contract: windowing space must be expressed through elements a table
// layout actually respects (dedicated spacer <tr> rows), never through
// padding on <tbody>.

function makeService(i: number) {
  return {
    metadata: { name: `svc-${String(i).padStart(3, "0")}`, namespace: "default", creationTimestamp: new Date().toISOString() },
    spec: { type: "ClusterIP", clusterIP: "10.0.0.1", ports: [{ port: 80, protocol: "TCP" }] },
  };
}

const rows = Array.from({ length: 200 }, (_, i) => makeService(i));

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [], isLoading: false }),
}));

vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return {
    ...actual,
    useResourceStream: () => ({ rows, synced: true, connected: true }),
  };
});

function renderServicesTable() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/r/services"]}>
        <Routes>
          <Route path="/r/:kind" element={<ResourceTable />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ResourceTable virtualized list (regression: only a few rows ever show, can't scroll)", () => {
  // jsdom never runs layout, so every element reports clientHeight 0 regardless
  // of CSS. Give the scroll container a real-world viewport height so the
  // virtualizer actually windows the 200 rows below, the same way it would in
  // a running browser — otherwise every test would trivially render 0 rows,
  // which would hide the real bug behind an unrelated jsdom limitation.
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });

  it("does not fake windowing space with padding on <tbody> (browsers ignore padding on table row groups)", () => {
    renderServicesTable();
    const tbody = screen.getByRole("table").querySelector("tbody")!;
    expect(tbody.style.paddingTop).toBeFalsy();
    expect(tbody.style.paddingBottom).toBeFalsy();
  });

  it("expresses off-screen row space with real spacer rows a table layout actually honors", () => {
    renderServicesTable();
    const tbody = screen.getByRole("table").querySelector("tbody")!;
    const allTrs = [...tbody.querySelectorAll("tr")];
    const dataRows = allTrs.filter((tr) => tr.hasAttribute("data-index"));
    const spacerRows = allTrs.filter((tr) => !tr.hasAttribute("data-index"));

    // With 200 rows and a windowed render, not every row is mounted at once —
    // that's the point of virtualizing. But every row must still be reachable
    // by scrolling, which requires the *real* rendered DOM (not padding) to
    // account for the rows that aren't currently mounted.
    expect(dataRows.length).toBeGreaterThan(0);
    expect(dataRows.length).toBeLessThan(rows.length);
    expect(spacerRows.length).toBeGreaterThan(0);
    for (const spacer of spacerRows) {
      // A spacer row must carry its height on the <tr> itself (which table
      // layout respects), not rely on padding/margin.
      expect(spacer.style.height).toBeTruthy();
    }
  });
});
