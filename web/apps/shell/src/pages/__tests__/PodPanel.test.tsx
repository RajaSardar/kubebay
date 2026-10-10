import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PodPanel from "../PodPanel";
import { imageSigApi, triageApi } from "../../lib/api";

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

vi.mock("../../components/TriageTab", () => ({
  TriageTab: ({ cluster, namespace, pod }: { cluster: string; namespace: string; pod: string }) => (
    <div data-testid="triage-tab">
      {cluster}/{namespace}/{pod}
    </div>
  ),
}));

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  imageSigApi: { check: vi.fn(async () => []) },
  triageApi: { get: vi.fn(async () => ({ enabled: false, clusters: [], baseURL: "", model: "", key: { source: "", store: "" } })) },
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

describe("PodPanel — Signatures tab (backlog #45)", () => {
  beforeEach(() => {
    localStorage.removeItem("kb.drawerTab");
  });

  it("checks only this pod's images", async () => {
    render(<PodPanel pod={pod} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Signatures" }));
    fireEvent.click(screen.getByRole("button", { name: "Check signatures" }));
    await vi.waitFor(() => expect(imageSigApi.check).toHaveBeenCalledWith("kind-test", false, { ns: "team-a", pod: "web-abc-xyz" }));
  });
});

describe("PodPanel — Triage tab (backlog #13)", () => {
  beforeEach(() => {
    localStorage.removeItem("kb.drawerTab");
  });

  it("appears only for clusters where triage is on", async () => {
    vi.mocked(triageApi.get).mockResolvedValueOnce({ enabled: true, clusters: ["kind-test"], baseURL: "", model: "", key: { source: "", store: "" } });
    render(<PodPanel pod={pod} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Triage" }));
    expect(screen.getByTestId("triage-tab").textContent).toBe("kind-test/team-a/web-abc-xyz");
  });

  it("is absent while triage is off for the cluster", async () => {
    vi.mocked(triageApi.get).mockResolvedValueOnce({ enabled: true, clusters: ["prod"], baseURL: "", model: "", key: { source: "", store: "" } });
    render(<PodPanel pod={pod} onClose={() => {}} />);
    await vi.waitFor(() => expect(triageApi.get).toHaveBeenCalled());
    expect(screen.queryByRole("tab", { name: "Triage" })).toBeNull();
  });
});
