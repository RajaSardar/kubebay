import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DebugContainerModal } from "../DebugContainerModal";
import { api, settingsApi } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: { debugContainer: vi.fn() },
  settingsApi: { get: vi.fn() },
}));

function setup(cluster = "kind-dev") {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DebugContainerModal cluster={cluster} namespace="shop" pod="web-1" containers={["app", "sidecar"]} onCreated={onCreated} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onCreated, onClose };
}

describe("DebugContainerModal", () => {
  beforeEach(() => {
    vi.mocked(api.debugContainer).mockReset().mockResolvedValue({ container: "debugger-abcde", image: "x" });
    vi.mocked(settingsApi.get).mockReset().mockResolvedValue({ extraKubeconfigs: [], debugImage: "mirror.local/netshoot:1", debugImageDefault: "busybox:1.36" });
  });

  it("defaults the image to the configured debug image", async () => {
    setup();
    await waitFor(() => expect(screen.getByLabelText("Image")).toHaveValue("mirror.local/netshoot:1"));
  });

  it("falls back to the built-in default when none is configured", async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ extraKubeconfigs: [], debugImageDefault: "busybox:1.36" });
    setup();
    await waitFor(() => expect(screen.getByLabelText("Image")).toHaveValue("busybox:1.36"));
  });

  it("adds the container, targeting the chosen one, and reports its name", async () => {
    const { onCreated } = setup();
    await waitFor(() => expect(screen.getByLabelText("Image")).toHaveValue("mirror.local/netshoot:1"));
    fireEvent.change(screen.getByLabelText("Target container"), { target: { value: "sidecar" } });
    fireEvent.click(screen.getByRole("button", { name: "Add debug container" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("debugger-abcde"));
    expect(api.debugContainer).toHaveBeenCalledWith({
      cluster: "kind-dev",
      ns: "shop",
      name: "web-1",
      image: "mirror.local/netshoot:1",
      target: "sidecar",
    });
  });

  it("targets the first container by default", async () => {
    setup();
    await waitFor(() => expect(screen.getByLabelText("Image")).toHaveValue("mirror.local/netshoot:1"));
    fireEvent.click(screen.getByRole("button", { name: "Add debug container" }));
    await waitFor(() => expect(api.debugContainer).toHaveBeenCalled());
    expect(vi.mocked(api.debugContainer).mock.calls[0]![0]).toMatchObject({ target: "app" });
  });

  it("needs a second click on a cluster that looks like production", async () => {
    setup("prod-eks");
    await waitFor(() => expect(screen.getByLabelText("Image")).toHaveValue("mirror.local/netshoot:1"));
    expect(screen.getByText(/looks like production/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add debug container" }));
    expect(api.debugContainer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(api.debugContainer).toHaveBeenCalled());
  });

  it("shows the engine's error and does not report a container", async () => {
    vi.mocked(api.debugContainer).mockRejectedValue(new Error("forbidden: cannot patch pods/ephemeralcontainers"));
    const { onCreated } = setup();
    await waitFor(() => expect(screen.getByLabelText("Image")).toHaveValue("mirror.local/netshoot:1"));
    fireEvent.click(screen.getByRole("button", { name: "Add debug container" }));
    expect(await screen.findByText(/cannot patch pods\/ephemeralcontainers/)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
