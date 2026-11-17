import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PodPanel from "../PodPanel";
import { setEditDirty, resetEditGuard } from "../../lib/editGuard";

vi.mock("../../components/heavy", () => ({
  ExecTerm: () => <div data-testid="exec-term" />,
  YamlTab: () => <div data-testid="yaml-tab" />,
}));
vi.mock("../../components/PodSummary", () => ({ PodSummary: () => <div /> }));
vi.mock("../../components/PodGraphs", () => ({ PodGraphs: () => <div /> }));
vi.mock("../../components/ResizePanel", () => ({ ResizePanel: () => <div /> }));
vi.mock("../../components/PodVulnerabilitiesTab", () => ({ PodVulnerabilitiesTab: () => <div /> }));

const pod = { cluster: "kind-test", namespace: "team-a", pod: "web-abc-xyz", containers: ["nginx"], obj: { metadata: { name: "web-abc-xyz" } } };

describe("PodPanel: unapplied YAML edits", () => {
  beforeEach(() => localStorage.removeItem("kb.drawerTab"));
  afterEach(resetEditGuard);

  it("closes at once when nothing is dirty", () => {
    const onClose = vi.fn();
    render(<PodPanel pod={pod} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks before Close drops a dirty edit, and Keep editing keeps the drawer", () => {
    setEditDirty("x", true);
    const onClose = vi.fn();
    render(<PodPanel pod={pod} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("asks before a tab change drops a dirty edit", () => {
    setEditDirty("x", true);
    render(<PodPanel pod={pod} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeTruthy();
  });
});
