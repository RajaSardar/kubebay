import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PodPanel from "../PodPanel";
import { useCompare } from "../../lib/compare-store";

vi.mock("../../components/heavy", () => ({ ExecTerm: () => null, YamlTab: () => null }));
vi.mock("../../components/PodSummary", () => ({ PodSummary: () => null }));
vi.mock("../../components/PodGraphs", () => ({ PodGraphs: () => null }));
vi.mock("../../components/ResizePanel", () => ({ ResizePanel: () => null }));
vi.mock("../../components/PodVulnerabilitiesTab", () => ({ PodVulnerabilitiesTab: () => null }));

describe("PodPanel: Compare with…", () => {
  it("opens the compare dialog with this pod as the left side", () => {
    useCompare.getState().close();
    render(<PodPanel pod={{ cluster: "dev", namespace: "shop", pod: "web-1", containers: ["a"], obj: { metadata: { name: "web-1" } } }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare with…" }));
    expect(useCompare.getState()).toMatchObject({
      open: true,
      left: { cluster: "dev", gvr: "v1/pods", ns: "shop", name: "web-1", kind: "Pod" },
      right: null,
    });
  });
});
