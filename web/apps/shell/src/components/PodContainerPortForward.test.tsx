import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PodContainerPortForward } from "./PodContainerPortForward";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, pfList: vi.fn(), pfStart: vi.fn(), pfStop: vi.fn() } };
});

const openMock = vi.fn();

function renderControl(port = 8080) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PodContainerPortForward cluster="kind-a" namespace="prod" pod="web-1" podPort={port} />
    </QueryClientProvider>,
  );
}

describe("PodContainerPortForward", () => {
  beforeEach(() => {
    vi.mocked(api.pfList).mockReset().mockResolvedValue([]);
    vi.mocked(api.pfStart).mockReset();
    vi.mocked(api.pfStop).mockReset();
    openMock.mockReset();
    vi.stubGlobal("open", openMock);
  });

  it("shows a Forward button when no tunnel exists for this pod/port", async () => {
    renderControl();
    await waitFor(() => expect(screen.getByRole("button", { name: /forward/i })).toBeTruthy());
  });

  it("starts a tunnel and opens it in the browser on click", async () => {
    vi.mocked(api.pfStart).mockResolvedValue({
      id: "pf-1",
      cluster: "kind-a",
      namespace: "prod",
      pod: "web-1",
      podPort: 8080,
      localPort: 54321,
      startedAt: "2026-09-28T00:00:00Z",
    });
    renderControl();

    fireEvent.click(await screen.findByRole("button", { name: /forward/i }));

    await waitFor(() =>
      expect(api.pfStart).toHaveBeenCalledWith({ cluster: "kind-a", namespace: "prod", pod: "web-1", podPort: 8080 }),
    );
    await waitFor(() => expect(openMock).toHaveBeenCalledWith("http://127.0.0.1:54321", "_blank", "noreferrer"));
  });

  it("shows Open/Stop instead of Forward when a tunnel for this pod/port already exists", async () => {
    vi.mocked(api.pfList).mockResolvedValue([
      { id: "pf-1", cluster: "kind-a", namespace: "prod", pod: "web-1", podPort: 8080, localPort: 54321, startedAt: "2026-09-28T00:00:00Z" },
    ]);
    renderControl();

    await waitFor(() => expect(screen.getByText(/127\.0\.0\.1:54321/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^forward$/i })).toBeNull();
  });

  it("stops the tunnel on click and reverts to a Forward button", async () => {
    vi.mocked(api.pfList)
      .mockResolvedValueOnce([
        { id: "pf-1", cluster: "kind-a", namespace: "prod", pod: "web-1", podPort: 8080, localPort: 54321, startedAt: "2026-09-28T00:00:00Z" },
      ])
      .mockResolvedValue([]);
    vi.mocked(api.pfStop).mockResolvedValue({ stopped: true });
    renderControl();

    fireEvent.click(await screen.findByRole("button", { name: /stop/i }));

    await waitFor(() => expect(api.pfStop).toHaveBeenCalledWith("pf-1"));
    await waitFor(() => expect(screen.getByRole("button", { name: /forward/i })).toBeTruthy());
  });

  it("ignores an existing tunnel for a different pod port", async () => {
    vi.mocked(api.pfList).mockResolvedValue([
      { id: "pf-1", cluster: "kind-a", namespace: "prod", pod: "web-1", podPort: 9090, localPort: 54321, startedAt: "2026-09-28T00:00:00Z" },
    ]);
    renderControl(8080);

    await waitFor(() => expect(screen.getByRole("button", { name: /forward/i })).toBeTruthy());
  });

  it("shows an error message when starting the tunnel fails", async () => {
    vi.mocked(api.pfStart).mockRejectedValue(new Error("tunnel not ready"));
    renderControl();

    fireEvent.click(await screen.findByRole("button", { name: /forward/i }));

    await waitFor(() => expect(screen.getByText(/tunnel not ready/i)).toBeTruthy());
  });
});
