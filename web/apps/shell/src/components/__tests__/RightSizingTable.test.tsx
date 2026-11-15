import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RightSizingTable, rowKey } from "../RightSizingTable";
import type { RightSizingRow } from "../../lib/rightsizing";

function row(overrides: Partial<RightSizingRow> = {}): RightSizingRow {
  return {
    ns: "default",
    workloadKind: "Deployment",
    workloadName: "app",
    container: "app",
    replicas: 3,
    vpaName: "app-vpa",
    vpaUpdateMode: "Off",
    currentCpuMillis: 500,
    currentMemBytes: 512 * 1024 * 1024,
    targetCpuMillis: 100,
    targetMemBytes: 128 * 1024 * 1024,
    wastedCpuMillis: 1200,
    wastedMemBytes: 384 * 1024 * 1024 * 3,
    cpuMaterial: true,
    memMaterial: true,
    material: true,
    hpaCpuConflict: false,
    gitopsOwner: null,
    source: "vpa",
    ...overrides,
  };
}

describe("rowKey", () => {
  it("is stable and unique per workload+container", () => {
    expect(rowKey(row())).toBe("default/Deployment/app/app");
  });
});

describe("RightSizingTable", () => {
  it("shows an empty state when there are no rows", () => {
    render(<RightSizingTable rows={[]} selected={{}} onToggle={vi.fn()} />);
    expect(screen.getByText(/no right-sizing opportunities/i)).toBeTruthy();
  });

  it("lists a row's workload, container, current vs target, and fleet-wide waste", () => {
    render(<RightSizingTable rows={[row()]} selected={{}} onToggle={vi.fn()} />);
    expect(screen.getAllByText("app").length).toBeGreaterThan(0);
    expect(screen.getByText(/500m/)).toBeTruthy();
    expect(screen.getByText(/100m/)).toBeTruthy();
  });

  it("disables the cpu checkbox and shows a conflict badge when hpaCpuConflict is true", () => {
    render(<RightSizingTable rows={[row({ hpaCpuConflict: true })]} selected={{}} onToggle={vi.fn()} />);
    expect(screen.getByText(/HPA/i)).toBeTruthy();
    const cpuBox = screen.getByRole("checkbox", { name: /cpu/i });
    expect((cpuBox as HTMLInputElement).disabled).toBe(true);
  });

  it("shows a GitOps badge for an owned workload", () => {
    render(
      <RightSizingTable
        rows={[row({ gitopsOwner: { controller: "argocd", name: "my-app" } })]}
        selected={{}}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/argo cd/i)).toBeTruthy();
  });

  it("calls onToggle with the row key and dimension when a checkbox is clicked", () => {
    const onToggle = vi.fn();
    render(<RightSizingTable rows={[row()]} selected={{}} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /^cpu/i }));
    expect(onToggle).toHaveBeenCalledWith("default/Deployment/app/app", "cpu");
  });

  it("does not render a checkbox for a dimension that isn't material", () => {
    render(<RightSizingTable rows={[row({ memMaterial: false })]} selected={{}} onToggle={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: /^memory/i })).toBeNull();
  });

  it("badges a VPA-sourced row as VPA", () => {
    render(<RightSizingTable rows={[row({ source: "vpa" })]} selected={{}} onToggle={vi.fn()} />);
    expect(screen.getByText("VPA")).toBeTruthy();
  });

  it("badges an engine-sourced row distinctly, with its observation window", () => {
    render(
      <RightSizingTable
        rows={[row({ source: "metrics-server", window: "observed over 3h, 180 samples" })]}
        selected={{}}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/kubebay/i)).toBeTruthy();
    expect(screen.getByText(/observed over 3h, 180 samples/i)).toBeTruthy();
  });

  it("badges a prometheus-sourced row distinctly from a metrics-server one", () => {
    render(
      <RightSizingTable
        rows={[row({ source: "prometheus", window: "7d probed (Prometheus, updated 14:03 UTC)" })]}
        selected={{}}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/prometheus/i).length).toBeGreaterThan(0);
  });

  it("shows an engine-sourced row as view-only, with no apply checkboxes (actuation is v3 scope)", () => {
    render(<RightSizingTable rows={[row({ source: "metrics-server" })]} selected={{}} onToggle={vi.fn()} />);
    expect(screen.getByText(/view only/i)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
