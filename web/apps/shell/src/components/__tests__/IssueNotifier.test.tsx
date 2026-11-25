import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Issue } from "../../lib/issues";
import { saveNotifySettings } from "../../lib/issueNotifications";

let hook: { issues: Issue[]; loading: boolean };
const useIssues = vi.fn((_c?: string) => ({ ...hook, notChecked: [], counts: { critical: 0, high: 0, medium: 0, low: 0 } }));
vi.mock("../../lib/useIssues", () => ({ useIssues: (c?: string) => useIssues(c) }));

import { IssueNotifier } from "../IssueNotifier";

type W = { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } };

function mk(name: string): Issue {
  return {
    id: `pod-problem|Pod|prod|${name}|CrashLoopBackOff`,
    cluster: "c1",
    detector: "pod-problem",
    code: "CrashLoopBackOff",
    severity: "critical",
    kind: "Pod",
    namespace: "prod",
    name,
    summary: "secret log line",
    blast: 1,
    evidence: { open: "route", path: "/pods" },
  };
}
function At() {
  const l = useLocation();
  return <div data-testid="at">{l.pathname + l.search}</div>;
}
const tree = (cluster: string | undefined) => (
  <MemoryRouter initialEntries={["/pods"]}>
    <IssueNotifier cluster={cluster} />
    <At />
  </MemoryRouter>
);

let invoke: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  hook = { issues: [], loading: false };
  useIssues.mockClear();
  invoke = vi.fn(async () => undefined);
  (window as unknown as W).__TAURI_INTERNALS__ = { invoke };
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
});
afterEach(() => {
  delete (window as unknown as W).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe("IssueNotifier", () => {
  it("opens no streams while notifications are off, or in a browser tab", () => {
    render(tree("c1"));
    expect(useIssues).not.toHaveBeenCalled();
    delete (window as unknown as W).__TAURI_INTERNALS__;
    saveNotifySettings({ enabled: true, minSeverity: "critical", mutedClusters: [] });
    render(tree("c1"));
    expect(useIssues).not.toHaveBeenCalled();
  });

  it("notifies a new critical issue after the baseline, with no log text", async () => {
    saveNotifySettings({ enabled: true, minSeverity: "critical", mutedClusters: [] });
    hook = { issues: [mk("a")], loading: false };
    const { rerender } = render(tree("c1"));
    expect(invoke).not.toHaveBeenCalled();
    hook = { issues: [mk("a"), mk("b")], loading: false };
    rerender(tree("c1"));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("notify_issue", { title: "Critical issue", body: "Pod prod/b" });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/secret log line/);
  });

  it("opens the issue when the window gains focus right after a notification", async () => {
    saveNotifySettings({ enabled: true, minSeverity: "critical", mutedClusters: [] });
    const { rerender } = render(tree("c1"));
    hook = { issues: [mk("b")], loading: false };
    rerender(tree("c1"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByTestId("at").textContent).toBe(`/issues?issue=${encodeURIComponent(mk("b").id)}`);
  });

  it("does not navigate on focus when nothing was notified", () => {
    saveNotifySettings({ enabled: true, minSeverity: "critical", mutedClusters: [] });
    render(tree("c1"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByTestId("at").textContent).toBe("/pods");
  });
});
