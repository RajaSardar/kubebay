import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { WarningSparkline } from "../WarningSparkline";
import * as stream from "../../lib/useResourceStream";

// The workload drawer answers "is this new or has it been going on?" with the
// workload's warnings over the last hour. Nothing renders without warnings.

vi.mock("../../lib/useResourceStream", () => ({ useResourceStream: vi.fn() }));

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const deploy = { kind: "Deployment", metadata: { name: "api", namespace: "shop" }, spec: { selector: { matchLabels: { app: "api" } } } };
const pods = [{ metadata: { name: "api-7f9-a", namespace: "shop", labels: { app: "api" } } }];
const warn = (minAgo: number, extra: Record<string, unknown> = {}) => ({
  type: "Warning",
  reason: "BackOff",
  involvedObject: { kind: "Pod", name: "api-7f9-a", namespace: "shop" },
  lastTimestamp: ago(minAgo),
  count: 1,
  ...extra,
});

function streams(events: unknown[]) {
  vi.mocked(stream.useResourceStream).mockImplementation(((_c: string, gvr: string) => ({
    rows: gvr === "v1/events" ? events : gvr === "v1/pods" ? pods : [],
    synced: true,
  })) as never);
}

describe("WarningSparkline", () => {
  beforeEach(() => vi.mocked(stream.useResourceStream).mockReset());

  it("is a labelled section: a count, whether it is new, and a zero-based bar per 5 minutes", () => {
    streams([warn(2), warn(3), warn(4)]);
    render(<WarningSparkline cluster="kind-shop" obj={deploy} />);
    const section = screen.getByRole("region", { name: "Warnings, last hour" });
    expect(within(section).getByText("3 warnings · new, first 4 min ago")).toBeInTheDocument();
    const chart = within(section).getByRole("img");
    expect(chart).toHaveAccessibleName("Warnings per 5 minutes over the last hour, oldest first: 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3");
    expect(chart.querySelectorAll("rect[data-count]")).toHaveLength(12);
  });

  it("says when it has gone on all hour, or when it started", () => {
    streams([warn(0, { firstTimestamp: ago(80), count: 40 })]);
    const { unmount } = render(<WarningSparkline cluster="kind-shop" obj={deploy} />);
    expect(screen.getByText(/· going on all hour$/)).toBeInTheDocument();
    unmount();
    streams([warn(30)]);
    render(<WarningSparkline cluster="kind-shop" obj={deploy} />);
    expect(screen.getByText("1 warning · started 30 min ago")).toBeInTheDocument();
  });

  it("renders nothing when the workload has had no warnings", () => {
    streams([{ ...warn(2), type: "Normal" }]);
    const { container } = render(<WarningSparkline cluster="kind-shop" obj={deploy} />);
    expect(container).toBeEmptyDOMElement();
  });
});
