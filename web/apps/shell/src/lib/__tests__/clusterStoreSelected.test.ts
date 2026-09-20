import { describe, it, expect, beforeEach } from "vitest";
import { useClusterStore } from "../cluster-store";

// TDD: Regression guard for the selected vs active cluster distinction.
// "active" = the cluster that navigation connects to (persisted, navigates away).
// "selected" = the row the user clicked for preview (ephemeral, no navigation).

describe("useClusterStore – selected field", () => {
  beforeEach(() => {
    useClusterStore.setState({ active: "", selected: "" });
  });

  it("initial selected is empty string", () => {
    expect(useClusterStore.getState().selected).toBe("");
  });

  it("setSelected highlights a row without changing active", () => {
    useClusterStore.getState().setActive("prod");
    useClusterStore.getState().setSelected("staging");
    expect(useClusterStore.getState().active).toBe("prod");
    expect(useClusterStore.getState().selected).toBe("staging");
  });

  it("setActive does not change selected", () => {
    useClusterStore.getState().setSelected("staging");
    useClusterStore.getState().setActive("prod");
    expect(useClusterStore.getState().selected).toBe("staging");
  });

  it("can deselect by setting selected to empty string", () => {
    useClusterStore.getState().setSelected("staging");
    useClusterStore.getState().setSelected("");
    expect(useClusterStore.getState().selected).toBe("");
  });
});
