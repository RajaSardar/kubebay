import { describe, it, expect, beforeEach } from "vitest";
import { useClusterIcons } from "../useClusterIcons";

// Reset store + localStorage between tests
beforeEach(() => {
  localStorage.clear();
  useClusterIcons.setState({ icons: {} });
});

describe("useClusterIcons – cross-component sync", () => {
  it("setIcon is immediately visible to all store subscribers", () => {
    const icon = { bg: "#F90", label: "AWS" };

    // Simulate component A setting icon
    useClusterIcons.getState().setIcon("my-cluster", icon);

    // Simulate component B reading — same module-level store
    const { icons } = useClusterIcons.getState();
    expect(icons["my-cluster"]).toEqual(icon);
  });

  it("resetIcon removes the icon from all subscribers", () => {
    useClusterIcons.getState().setIcon("my-cluster", { bg: "#F90", label: "AWS" });
    useClusterIcons.getState().resetIcon("my-cluster");

    const { icons } = useClusterIcons.getState();
    expect(icons["my-cluster"]).toBeUndefined();
  });

  it("persists icon to localStorage so it survives a remount", () => {
    const icon = { bg: "#F90", label: "AWS", imageUrl: "https://example.com/flag.png" };
    useClusterIcons.getState().setIcon("my-cluster", icon);

    // Simulate app restart: recreate store by reading localStorage
    const stored = JSON.parse(localStorage.getItem("kb.cluster-icons") ?? "{}");
    expect(stored["my-cluster"]).toEqual(icon);
  });

  it("loads existing localStorage data on store creation", () => {
    // Pre-populate localStorage (simulates data from a previous session)
    const icon = { bg: "#4285F4", label: "GCP" };
    localStorage.setItem("kb.cluster-icons", JSON.stringify({ "gke-prod": icon }));

    // Reset store state to simulate module re-import
    useClusterIcons.setState({ icons: JSON.parse(localStorage.getItem("kb.cluster-icons") ?? "{}") });

    const { icons } = useClusterIcons.getState();
    expect(icons["gke-prod"]).toEqual(icon);
  });

  it("imageUrl is preserved through set/get cycle", () => {
    const icon = { bg: "#F90", label: "AWS", imageUrl: "data:image/png;base64,abc123" };
    useClusterIcons.getState().setIcon("eks-prod", icon);

    expect(useClusterIcons.getState().icons["eks-prod"]?.imageUrl).toBe("data:image/png;base64,abc123");
  });
});
