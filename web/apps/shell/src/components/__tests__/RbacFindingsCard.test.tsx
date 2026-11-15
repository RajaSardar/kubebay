import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RbacFindingsCard } from "../RbacFindingsCard";
import type { RBACFinding } from "../../lib/api";

function finding(overrides: Partial<RBACFinding> = {}): RBACFinding {
  return {
    severity: "high",
    title: "Wildcard verb (*)",
    subject: "ServiceAccount default/sa1",
    roleRef: "ClusterRole:my-role",
    why: "grants every action",
    ...overrides,
  };
}

describe("RbacFindingsCard", () => {
  it("shows an empty state when there are no findings", () => {
    render(<RbacFindingsCard findings={[]} onQuery={vi.fn()} />);
    expect(screen.getByText(/no findings/i)).toBeTruthy();
  });

  it("lists each finding's severity, title, subject, and why", () => {
    render(<RbacFindingsCard findings={[finding()]} onQuery={vi.fn()} />);
    expect(screen.getByText("Wildcard verb (*)")).toBeTruthy();
    expect(screen.getByText(/ServiceAccount default\/sa1/)).toBeTruthy();
    expect(screen.getByText("grants every action")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
  });

  it("hides system:* findings by default, and shows them when the toggle is unchecked", () => {
    const findings = [finding({ roleRef: "ClusterRole:system:controller:x", title: "System role finding" })];
    render(<RbacFindingsCard findings={findings} onQuery={vi.fn()} />);
    expect(screen.queryByText("System role finding")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: /hide system/i }));
    expect(screen.getByText("System role finding")).toBeTruthy();
  });

  it("shows a 'who else has this' button only for findings with a query hint, and calls onQuery when clicked", () => {
    const onQuery = vi.fn();
    const findings = [
      finding({ title: "Cluster-wide Secret read access", verb: "get", group: "", resource: "secrets" }),
      finding({ title: "Wildcard verb (*)" }),
    ];
    render(<RbacFindingsCard findings={findings} onQuery={onQuery} />);
    const buttons = screen.getAllByRole("button", { name: /show who else has this/i });
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]!);
    expect(onQuery).toHaveBeenCalledWith({ verb: "get", group: "", resource: "secrets" });
  });

  it("sorts high-severity findings before medium", () => {
    const findings = [
      finding({ title: "Medium one", severity: "medium" }),
      finding({ title: "High one", severity: "high" }),
    ];
    render(<RbacFindingsCard findings={findings} onQuery={vi.fn()} />);
    const titles = screen.getAllByText(/one$/).map((el) => el.textContent);
    expect(titles).toEqual(["High one", "Medium one"]);
  });

  it("tags each finding with its framework control IDs", () => {
    render(<RbacFindingsCard findings={[finding({ title: "Cluster-wide pod exec access" })]} onQuery={vi.fn()} />);
    expect(screen.getByText("ATT&CK T1609")).toBeInTheDocument();
  });
});
