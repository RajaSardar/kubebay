import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RolloutsInProgress } from "../RolloutsInProgress";
import { PodStatusBar } from "../PodStatusBar";
import type { RolloutRow } from "../../lib/rolloutsInProgress";

const wl = { metadata: { name: "api", namespace: "shop" }, spec: { selector: { matchLabels: { app: "api" } } } };
const rolling: RolloutRow = { key: "Deployment/shop/api", kind: "Deployment", namespace: "shop", name: "api", updated: 3, ready: 2, desired: 4, stalled: false, workload: wl };

describe("RolloutsInProgress", () => {
  it("is not drawn while nothing is rolling out", () => {
    const { container } = render(<MemoryRouter><RolloutsInProgress rows={[]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each rollout's progress like a CI step, and a stalled one in red with why", () => {
    render(
      <MemoryRouter>
        <RolloutsInProgress rows={[{ ...rolling, key: "x", name: "pay", stalled: true, reason: "timed out progressing" }, rolling]} />
      </MemoryRouter>,
    );
    const section = screen.getByRole("region", { name: /Rollouts in progress/ });
    const api = within(section).getByText("api").closest("tr")!;
    expect(within(api).getByText("3 of 4 updated · 2 ready")).toBeInTheDocument();
    expect(within(api).getByText("Rolling out")).toBeInTheDocument();
    expect(within(api).getByRole("img", { name: "3 of 4 updated" })).toBeInTheDocument();
    const pay = within(section).getByText("pay").closest("tr")!;
    expect(within(pay).getByText("Stalled")).toHaveClass("status-err");
    expect(within(pay).getByText("timed out progressing")).toBeInTheDocument();
    expect(within(api).getByRole("link", { name: "Show pods" })).toHaveAttribute("href", "/workloads?ns=shop&selector=app%3Dapi&of=Deployment%2Fapi");
  });
});

describe("PodStatusBar", () => {
  const segs = [
    { label: "Running", count: 600, tone: "ok" as const, to: "/workloads?q=status%3ARunning" },
    { label: "CrashLoopBackOff", count: 4, tone: "err" as const, to: "/workloads?q=status%3ACrashLoopBackOff" },
  ];

  it("labels every segment with its count and word, each a link to those pods", () => {
    render(<MemoryRouter><PodStatusBar segments={segs} /></MemoryRouter>);
    const section = screen.getByRole("region", { name: /Pods by status/ });
    expect(within(section).getByText("604 pods")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "Running 600" })).toHaveAttribute("href", "/workloads?q=status%3ARunning");
    expect(within(section).getByRole("link", { name: "CrashLoopBackOff 4" })).toHaveAttribute("href", "/workloads?q=status%3ACrashLoopBackOff");
  });

  it("is not drawn with no pods", () => {
    const { container } = render(<MemoryRouter><PodStatusBar segments={[]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
