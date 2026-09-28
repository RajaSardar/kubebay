import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PodPanel from "../PodPanel";

vi.mock("../../components/heavy", () => ({
  ExecTerm: () => <div data-testid="exec-term" />,
  YamlTab: () => <div data-testid="yaml-tab" />,
}));
vi.mock("../../components/PodSummary", () => ({ PodSummary: () => <div data-testid="pod-summary" /> }));
vi.mock("../../components/PodGraphs", () => ({ PodGraphs: () => <div data-testid="pod-graphs" /> }));
vi.mock("../../components/ResizePanel", () => ({ ResizePanel: () => <div data-testid="resize-panel" /> }));
vi.mock("../../components/PodVulnerabilitiesTab", () => ({
  PodVulnerabilitiesTab: ({ ns, podName, containers }: { ns: string; podName: string; containers: string[] }) => (
    <div data-testid="pod-vulnerabilities">
      {ns}/{podName} [{containers.join(",")}]
    </div>
  ),
}));

const pod = { cluster: "kind-test", namespace: "team-a", pod: "web-abc-xyz", containers: ["nginx"], obj: { metadata: { name: "web-abc-xyz" } } };

describe("PodPanel — Vulnerabilities tab wiring (backlog #16)", () => {
  beforeEach(() => {
    // PodPanel persists the active tab across mounts via this key — reset it
    // so one test's tab click doesn't leak into the next test's initial render.
    localStorage.removeItem("kb.drawerTab");
  });

  it("shows a Vulnerabilities tab button that renders PodVulnerabilitiesTab with the pod's identity", () => {
    render(<PodPanel pod={pod} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /vulnerabilities/i }));

    expect(screen.getByTestId("pod-vulnerabilities").textContent).toBe("team-a/web-abc-xyz [nginx]");
  });

  it("does not render the vulnerabilities tab content until it's selected", () => {
    render(<PodPanel pod={pod} onClose={() => {}} />);
    expect(screen.queryByTestId("pod-vulnerabilities")).toBeNull();
  });
});
