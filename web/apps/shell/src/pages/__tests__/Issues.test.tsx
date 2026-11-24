import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Issue } from "../../lib/issues";

let hookResult: ReturnType<typeof import("../../lib/useIssues").useIssues>;
let activeCluster: string | undefined = "c1";
vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: activeCluster, setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../lib/useIssues", () => ({ useIssues: () => hookResult }));

import Issues from "../Issues";

const NOW = Date.now();
function mk(over: Partial<Issue>): Issue {
  return {
    id: "x",
    cluster: "c1",
    detector: "pod-problem",
    code: "CrashLoopBackOff",
    severity: "high",
    kind: "Deployment",
    namespace: "shop",
    name: "web",
    summary: "Keeps crashing on start (CrashLoopBackOff), 1 of 2 ready",
    since: NOW - 3 * 3_600_000,
    blast: 2,
    evidence: { open: "object", slug: "pods", ns: "shop", name: "web-1" },
    ...over,
  };
}
const counts = { critical: 1, high: 1, medium: 1, low: 0 };
const issues: Issue[] = [
  mk({ id: "a", severity: "critical", detector: "node-condition", kind: "Node", namespace: "", name: "n1", code: "NodeNotReady", summary: "Node is not Ready", evidence: { open: "object", slug: "nodes", ns: "", name: "n1" } }),
  mk({ id: "b" }),
  mk({ id: "c", severity: "medium", detector: "best-practice", kind: "Best practice", namespace: "", name: "Privileged containers", summary: "1 workload runs privileged", evidence: { open: "route", path: "/best-practices" }, since: undefined }),
];

function Where() {
  const l = useLocation();
  return <div data-testid="at">{l.pathname + l.search}</div>;
}
function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/issues"]}>
      <Routes>
        <Route path="/issues" element={<Issues />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}
const ready = (over: Partial<typeof hookResult> = {}) => {
  hookResult = { issues, notChecked: [], counts, loading: false, ...over };
};

describe("Issues page", () => {
  it("lists issues in the order given with severity, object, namespace, explanation and age", () => {
    ready();
    renderPage();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("critical")).toBeTruthy();
    expect(within(rows[0]!).getByText("n1")).toBeTruthy();
    expect(within(rows[1]!).getByText("web")).toBeTruthy();
    expect(within(rows[1]!).getByText("shop")).toBeTruthy();
    expect(within(rows[1]!).getByText(/Keeps crashing/)).toBeTruthy();
    expect(within(rows[1]!).getByText("3h")).toBeTruthy();
    expect(within(rows[1]!).getByText("Needs attention")).toBeTruthy();
  });

  it("filters by severity, kind and namespace", async () => {
    ready();
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText("Severity"), "critical");
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText("Severity"), "all");
    await userEvent.selectOptions(screen.getByLabelText("Namespace"), "shop");
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText("Namespace"), "all");
    await userEvent.selectOptions(screen.getByLabelText("Kind"), "Node");
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(1);
  });

  it("Investigate opens the pod for a pod issue and the page for a page issue", async () => {
    ready();
    const { unmount } = renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Investigate Deployment web" }));
    expect(screen.getByTestId("at").textContent).toBe("/workloads?pod=shop%2Fweb-1");
    unmount();
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Investigate Best practice Privileged containers" }));
    expect(screen.getByTestId("at").textContent).toBe("/best-practices");
  });

  it("shows names as text, never as markup", () => {
    const evil = "<img src=x onerror=alert(1)>";
    ready({ issues: [mk({ id: "e", name: evil, summary: evil })], counts: { critical: 0, high: 1, medium: 0, low: 0 } });
    const { container } = renderPage();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText(evil).length).toBeGreaterThan(0);
  });

  it("says all clear only when every detector was checked", () => {
    ready({ issues: [], counts: { critical: 0, high: 0, medium: 0, low: 0 } });
    renderPage();
    expect(screen.getByText(/No issues found/)).toBeTruthy();
  });

  it("never says all clear while something is not checked, and names it with the reason", () => {
    ready({ issues: [], counts: { critical: 0, high: 0, medium: 0, low: 0 }, notChecked: [{ detector: "node-condition", reason: "forbidden" }], loading: false });
    renderPage();
    expect(screen.queryByText(/No issues found/)).toBeNull();
    expect(screen.getByText(/Node conditions/)).toBeTruthy();
    expect(screen.getByText(/your access doesn't allow reading it/)).toBeTruthy();
  });

  it("shows a still-checking line while loading", () => {
    ready({ loading: true, notChecked: [{ detector: "spof", reason: "loading" }, { detector: "netpol-gap", reason: "loading" }] });
    renderPage();
    expect(screen.getByText(/Still checking 2 sources/)).toBeTruthy();
  });

  it("asks for a cluster when none is selected", () => {
    activeCluster = undefined;
    ready({ issues: [] });
    renderPage();
    expect(screen.getByText(/Connect a cluster/)).toBeTruthy();
    activeCluster = "c1";
  });
});
