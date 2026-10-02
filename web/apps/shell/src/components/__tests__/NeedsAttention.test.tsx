import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NeedsAttention } from "../NeedsAttention";
import type { AttentionRow } from "../../lib/attention";

const NOW = Date.now();
const api: AttentionRow = {
  key: "Deployment/shop/api",
  kind: "Deployment",
  namespace: "shop",
  name: "api",
  code: "CrashLoopBackOff",
  plain: "Keeps crashing on start",
  detail: "back-off 5m0s restarting failed container",
  severity: "err",
  ready: 1,
  desired: 3,
  restarts: 14,
  since: NOW - 12 * 60_000,
  pods: ["shop/api-7f9-a", "shop/api-7f9-b"],
  workload: { metadata: { name: "api", namespace: "shop" }, spec: { selector: { matchLabels: { app: "api" } } } },
};

function renderIt(rows: AttentionRow[], checkedAt = NOW) {
  return render(
    <MemoryRouter>
      <NeedsAttention rows={rows} checkedAt={checkedAt} />
    </MemoryRouter>,
  );
}

describe("NeedsAttention", () => {
  it("is a named section with a count", () => {
    renderIt([api]);
    const section = screen.getByRole("region", { name: /Needs attention/ });
    expect(within(section).getByText("1")).toBeInTheDocument();
  });

  it("says what broke in words, keeps the Kubernetes term, and shows ready of desired and restarts", () => {
    renderIt([api]);
    const row = screen.getByText("api").closest("tr")!;
    expect(within(row).getByText("Keeps crashing on start")).toBeInTheDocument();
    expect(within(row).getByText("CrashLoopBackOff · 14 restarts")).toBeInTheDocument();
    expect(within(row).getByText("1 of 3")).toBeInTheDocument();
    expect(within(row).getByText("12m")).toBeInTheDocument();
  });

  it("links to the workload's pods and to the worst pod's logs", () => {
    renderIt([api]);
    const row = screen.getByText("api").closest("tr")!;
    expect(within(row).getByRole("link", { name: "Show pods" })).toHaveAttribute(
      "href",
      "/workloads?ns=shop&selector=app%3Dapi&of=Deployment%2Fapi",
    );
    expect(within(row).getByRole("link", { name: "Show logs" })).toHaveAttribute("href", "/workloads?pod=shop%2Fapi-7f9-a&tab=logs");
  });

  it("links a bare pod to itself, and offers no logs when no pod is to blame", () => {
    renderIt([
      { ...api, key: "Pod/shop/solo", kind: "Pod", name: "solo", pods: ["shop/solo"], workload: undefined },
      { ...api, key: "Deployment/shop/quota", name: "quota", code: "MinimumReplicasUnavailable", plain: "Not enough copies running", severity: "warn", pods: [], restarts: 0 },
    ]);
    expect(within(screen.getByText("solo").closest("tr")!).getByRole("link", { name: "Show pods" })).toHaveAttribute("href", "/workloads?q=name%3Asolo+ns%3Ashop");
    const quota = screen.getByText("quota").closest("tr")!;
    expect(within(quota).queryByRole("link", { name: "Show logs" })).not.toBeInTheDocument();
    expect(within(quota).getByText("MinimumReplicasUnavailable")).toBeInTheDocument();
  });

  it("is calm when nothing is broken: a check, the words, and when it last checked", () => {
    renderIt([], Date.parse("2026-10-02T09:15:30"));
    const section = screen.getByRole("region", { name: /Needs attention/ });
    expect(within(section).getByText("Nothing needs attention")).toBeInTheDocument();
    expect(within(section).getByText(/Checked .*9:15/)).toBeInTheDocument();
    expect(within(section).queryByRole("table")).not.toBeInTheDocument();
  });
});
