import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NeedsAttention } from "../NeedsAttention";
import type { AttentionRow } from "../../lib/attention";
import * as logs from "../../lib/usePodLogs";

// The last log line says why a pod keeps crashing without opening its logs.
// It loads lazily, for the top five rows only, so the page stays fast at 600 pods.

vi.mock("../../lib/usePodLogs", () => ({ usePodLogs: vi.fn() }));

const api: AttentionRow = {
  key: "Deployment/shop/api",
  kind: "Deployment",
  namespace: "shop",
  name: "api",
  code: "CrashLoopBackOff",
  plain: "Keeps crashing on start",
  detail: "",
  severity: "err",
  ready: 1,
  desired: 3,
  restarts: 14,
  pods: ["shop/api-7f9-a"],
};

function renderIt(rows: AttentionRow[], cluster?: string) {
  return render(
    <MemoryRouter>
      <NeedsAttention rows={rows} checkedAt={Date.now()} cluster={cluster} />
    </MemoryRouter>,
  );
}

describe("NeedsAttention last log line", () => {
  beforeEach(() => {
    vi.mocked(logs.usePodLogs).mockReset();
    vi.mocked(logs.usePodLogs).mockImplementation((spec) =>
      spec ? { lines: ["starting", `panic: DB_URL not set (${spec.pod})`], status: "closed", error: "" } : { lines: [], status: "idle", error: "" },
    );
  });

  it("shows the worst pod's last log line under the problem, from the crashed run", () => {
    renderIt([api], "kind-shop");
    const row = screen.getByText("api").closest("tr")!;
    expect(within(row).getByText("panic: DB_URL not set (api-7f9-a)")).toHaveAttribute("title", "Last log line of shop/api-7f9-a");
    expect(logs.usePodLogs).toHaveBeenCalledWith({ cluster: "kind-shop", namespace: "shop", pod: "api-7f9-a", tail: 20, follow: false, previous: true });
  });

  it("reads the running container when the pod has not restarted", () => {
    renderIt([{ ...api, restarts: 0 }], "kind-shop");
    expect(logs.usePodLogs).toHaveBeenCalledWith(expect.objectContaining({ pod: "api-7f9-a", previous: false }));
  });

  it("loads logs for the top five rows only", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ ...api, key: `Deployment/shop/w${i}`, name: `w${i}`, pods: [`shop/w${i}-pod`] }));
    renderIt(rows, "kind-shop");
    const asked = vi.mocked(logs.usePodLogs).mock.calls.map(([s]) => s?.pod).filter(Boolean);
    expect(new Set(asked)).toEqual(new Set(["w0-pod", "w1-pod", "w2-pod", "w3-pod", "w4-pod"]));
    expect(within(screen.getByText("w5").closest("tr")!).queryByText(/panic/)).not.toBeInTheDocument();
  });

  it("shows nothing when there is no log line, no pod, or no cluster", () => {
    vi.mocked(logs.usePodLogs).mockReturnValue({ lines: [], status: "closed", error: "previous terminated container not found" });
    renderIt([api, { ...api, key: "Deployment/shop/quota", name: "quota", pods: [] }], "kind-shop");
    expect(screen.queryByTitle(/Last log line/)).not.toBeInTheDocument();
    vi.mocked(logs.usePodLogs).mockClear();
    renderIt([api]);
    expect(vi.mocked(logs.usePodLogs).mock.calls.every(([s]) => s === null)).toBe(true);
  });
});
