import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ historyApi: { enroll: vi.fn(async () => ({ recording: true })) } }));

import { useClusterStore } from "../cluster-store";
import { historyApi } from "../api";

describe("useClusterStore – usage history consent (backlog #36)", () => {
  beforeEach(() => {
    vi.mocked(historyApi.enroll).mockClear();
    useClusterStore.setState({ active: "" });
  });

  it("connecting to a cluster enrolls it for history recording", () => {
    useClusterStore.getState().setActive("kind-dev");
    expect(historyApi.enroll).toHaveBeenCalledWith("kind-dev");
  });

  it("clearing the active cluster does not enroll anything", () => {
    useClusterStore.getState().setActive("");
    expect(historyApi.enroll).not.toHaveBeenCalled();
  });

  it("a failed enroll never breaks connecting", async () => {
    vi.mocked(historyApi.enroll).mockRejectedValueOnce(new Error("engine down"));
    expect(() => useClusterStore.getState().setActive("kind-dev")).not.toThrow();
    await Promise.resolve();
    expect(useClusterStore.getState().active).toBe("kind-dev");
  });
});
