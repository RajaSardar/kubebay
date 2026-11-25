import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DashStatus } from "../lib/rolloutsDash";

const api = vi.hoisted(() => ({
  status: vi.fn(),
  start: vi.fn(),
  heartbeat: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../lib/rolloutsDash", async (orig) => ({ ...(await orig<typeof import("../lib/rolloutsDash")>()), rolloutsDashApi: api }));

import { ArgoDashboard } from "./ArgoDashboard";

const running: DashStatus = { state: "running", url: "/api/rollouts-dashboard/TOKEN/" };

beforeEach(() => {
  api.status.mockReset();
  api.start.mockReset();
  api.heartbeat.mockReset().mockResolvedValue(true);
  api.release.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => vi.useRealTimers());

describe("ArgoDashboard", () => {
  it("starts a stopped dashboard and frames it only once it is running", async () => {
    api.status.mockResolvedValue({ state: "stopped" });
    let finish!: (s: DashStatus) => void;
    api.start.mockReturnValue(new Promise<DashStatus>((r) => (finish = r)));
    const { container } = render(<ArgoDashboard cluster="c1" namespaces={["shop"]} onUseReleaseView={() => {}} />);
    expect(await screen.findByText(/Starting the Argo dashboard/)).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull(); // not before it answers
    expect(api.start).toHaveBeenCalledWith("c1", ["shop"]);
    await act(async () => finish(running));
    const frame = await waitFor(() => {
      const f = container.querySelector("iframe");
      if (!f) throw new Error("no frame");
      return f;
    });
    expect(frame.getAttribute("src")).toBe("/api/rollouts-dashboard/TOKEN/");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(frame.getAttribute("sandbox")).not.toMatch(/allow-same-origin/);
  });

  it("reuses an already running dashboard without starting another", async () => {
    api.status.mockResolvedValue(running);
    const { container } = render(<ArgoDashboard cluster="c1" onUseReleaseView={() => {}} />);
    await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
    expect(api.start).not.toHaveBeenCalled();
  });

  it("starts again when the running dashboard was started for another namespace", async () => {
    api.status.mockResolvedValue({ ...running, namespace: "shop" });
    api.start.mockResolvedValue({ ...running, url: "/api/rollouts-dashboard/OTHER/", namespace: "infra" });
    const { container } = render(<ArgoDashboard cluster="c1" namespaces={["infra"]} onUseReleaseView={() => {}} />);
    await waitFor(() => expect(container.querySelector("iframe")?.getAttribute("src")).toBe("/api/rollouts-dashboard/OTHER/"));
    expect(api.start).toHaveBeenCalledWith("c1", ["infra"]);
  });

  it("explains how to install the plugin and offers the Release view, installing nothing", async () => {
    api.status.mockResolvedValue({
      state: "not-installed",
      install: { commands: ["brew install argoproj/tap/kubectl-argo-rollouts", "kubectl krew install argo-rollouts"], releasesUrl: "https://github.com/argoproj/argo-rollouts/releases" },
    });
    const useRelease = vi.fn();
    const { container } = render(<ArgoDashboard cluster="c1" onUseReleaseView={useRelease} />);
    expect(await screen.findByText(/kubectl-argo-rollouts is not installed/)).toBeTruthy();
    expect(screen.getByText("brew install argoproj/tap/kubectl-argo-rollouts")).toBeTruthy();
    expect(screen.getByText("kubectl krew install argo-rollouts")).toBeTruthy();
    expect(screen.getByRole("link", { name: /releases/i }).getAttribute("href")).toBe("https://github.com/argoproj/argo-rollouts/releases");
    expect(container.querySelector("iframe")).toBeNull();
    expect(api.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Rollouts view/ }));
    expect(useRelease).toHaveBeenCalled();
  });

  it("shows why it failed with the tool's stderr as text, and can retry", async () => {
    api.status.mockResolvedValue({ state: "stopped" });
    api.start.mockResolvedValueOnce({ state: "failed", message: "the dashboard did not answer within 15s", stderrTail: "<b>boom</b> no route to host" });
    const { container } = render(<ArgoDashboard cluster="c1" onUseReleaseView={() => {}} />);
    expect(await screen.findByText(/did not answer within 15s/)).toBeTruthy();
    expect(screen.getByText(/<b>boom<\/b> no route to host/)).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
    api.start.mockResolvedValueOnce(running);
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
  });

  it("shows a refused start (cap reached) as a failure", async () => {
    api.status.mockResolvedValue({ state: "stopped" });
    api.start.mockRejectedValue(new Error("three Argo dashboards are already running; close another one first"));
    render(<ArgoDashboard cluster="c1" onUseReleaseView={() => {}} />);
    expect(await screen.findByText(/close another one first/)).toBeTruthy();
  });

  it("sends a heartbeat while open and releases when left", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.status.mockResolvedValue(running);
    const { unmount } = render(<ArgoDashboard cluster="c1" onUseReleaseView={() => {}} />);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(api.heartbeat).toHaveBeenCalledWith("c1");
    unmount();
    expect(api.release).toHaveBeenCalledWith("c1");
  });

  it("silently restarts when the engine no longer has the dashboard", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.status.mockResolvedValueOnce(running).mockResolvedValue({ state: "stopped" });
    api.heartbeat.mockResolvedValue(false);
    api.start.mockResolvedValue({ state: "running", url: "/api/rollouts-dashboard/NEW/" });
    const { container } = render(<ArgoDashboard cluster="c1" onUseReleaseView={() => {}} />);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(31_000);
    await waitFor(() => expect(container.querySelector("iframe")?.getAttribute("src")).toBe("/api/rollouts-dashboard/NEW/"));
    expect(screen.queryByText(/failed|error/i)).toBeNull();
  });
});
