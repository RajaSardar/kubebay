import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PodPanel from "../PodPanel";
import { api } from "../../lib/api";

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

describe("PodPanel — force delete only when it does something (backlog #18)", () => {
  beforeEach(() => {
    localStorage.removeItem("kb.drawerTab");
  });

  function openDelete(obj: Record<string, unknown>) {
    render(<PodPanel pod={{ ...pod, obj }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  }

  it("offers to skip the grace period for a running pod", () => {
    openDelete({ metadata: { name: "web-abc-xyz" }, spec: { nodeName: "n1" }, status: { phase: "Running" } });
    expect(screen.getByLabelText("force (skip grace period)")).toBeInTheDocument();
  });

  it("hides force for a finished pod without finalizers", () => {
    openDelete({ metadata: { name: "web-abc-xyz" }, spec: { nodeName: "n1" }, status: { phase: "Succeeded" } });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("offers only finalizer removal for a finished pod a finalizer holds", () => {
    openDelete({ metadata: { name: "web-abc-xyz", finalizers: ["batch.kubernetes.io/job-tracking"] }, spec: { nodeName: "n1" }, status: { phase: "Succeeded" } });
    expect(screen.getByLabelText("remove finalizers")).toBeInTheDocument();
  });
});

describe("PodPanel: plain delete confirmation", () => {
  beforeEach(() => {
    localStorage.removeItem("kb.drawerTab");
    vi.restoreAllMocks();
  });

  it("asks for a plain confirmation naming the pod, with no typed input", () => {
    render(<PodPanel pod={pod} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete web-abc-xyz?" });
    expect(dialog).toHaveTextContent("Delete web-abc-xyz?");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("deletes on one click of the dialog's Delete button", async () => {
    const del = vi.spyOn(api, "deleteResource").mockResolvedValue(undefined as never);
    const onClose = vi.fn();
    render(<PodPanel pod={pod} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete web-abc-xyz?" });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Delete")!);
    await waitFor(() => expect(del).toHaveBeenCalled());
    expect(del.mock.calls[0]![0]).toMatchObject({ gvr: "v1/pods", ns: "team-a", name: "web-abc-xyz" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Cancel closes the dialog without deleting", () => {
    const del = vi.spyOn(api, "deleteResource").mockResolvedValue(undefined as never);
    render(<PodPanel pod={pod} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Delete web-abc-xyz?" })).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });
});
