import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Badge, IconButton, SegmentedControl, Tabs } from "@kubebay/ui";

describe("IconButton", () => {
  it("is a labelled, non-submitting button whose tooltip defaults to its label", () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(
      <IconButton ref={ref} label="Close" onClick={onClick}>
        ×
      </IconButton>,
    );
    const b = screen.getByRole("button", { name: "Close" });
    expect(b).toHaveClass("kb-icon-btn");
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveAttribute("title", "Close");
    expect(ref.current).toBe(b);
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalled();
  });

  it("shows a pressed state for toggles and takes its own tooltip", () => {
    render(
      <IconButton label="Toggle split view" title="Split view (⌘⇧S)" active>
        ⊟
      </IconButton>,
    );
    const b = screen.getByRole("button", { name: "Toggle split view" });
    expect(b).toHaveClass("kb-icon-btn", "active");
    expect(b).toHaveAttribute("aria-pressed", "true");
    expect(b).toHaveAttribute("title", "Split view (⌘⇧S)");
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "matrix", label: "Connectivity matrix" },
    { value: "policies", label: "Policy list" },
  ] as const;

  it("is a radio group that marks the chosen segment and reports clicks", () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="View" options={options} value="matrix" onChange={onChange} />);
    expect(screen.getByRole("radiogroup", { name: "View" })).toHaveClass("kb-segmented");
    const matrix = screen.getByRole("radio", { name: "Connectivity matrix" });
    expect(matrix).toHaveAttribute("aria-checked", "true");
    expect(matrix).toHaveClass("kb-segment", "active");
    expect(screen.getByRole("radio", { name: "Policy list" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("radio", { name: "Policy list" }));
    expect(onChange).toHaveBeenCalledWith("policies");
  });

  it("moves with the arrow keys and keeps only the chosen segment in the tab order", () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="View" options={options} value="matrix" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Connectivity matrix" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Policy list" })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Connectivity matrix" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("policies");
    expect(screen.getByRole("radio", { name: "Policy list" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("radio", { name: "Connectivity matrix" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("policies");
  });
});

describe("Badge tones", () => {
  it("adds warn and info to ok and err", () => {
    render(
      <>
        <Badge tone="warn">cluster</Badge>
        <Badge tone="info">namespaced</Badge>
        <Badge>3 columns</Badge>
      </>,
    );
    expect(screen.getByText("cluster")).toHaveClass("kb-badge", "kb-badge-warn");
    expect(screen.getByText("namespaced")).toHaveClass("kb-badge", "kb-badge-info");
    expect(screen.getByText("3 columns").className).toBe("kb-badge");
  });
});

describe("Tabs style", () => {
  it("passes a style through to the tab list", () => {
    const { container } = render(<Tabs tabs={["a"]} active="a" onChange={() => {}} style={{ marginBottom: 14 }} />);
    expect(container.firstChild).toHaveStyle({ marginBottom: "14px" });
  });
});

describe("Tabs trailing", () => {
  it("renders trailing controls in the tab row but outside the tab list", () => {
    render(
      <Tabs tabs={["logs", "yaml"]} active="logs" onChange={() => {}} trailing={<select aria-label="Container" />} />,
    );
    const list = screen.getByRole("tablist");
    expect(list).not.toContainElement(screen.getByRole("combobox", { name: "Container" }));
    expect(list.parentElement).toContainElement(screen.getByRole("combobox", { name: "Container" }));
    expect(list.parentElement).toHaveClass("tabs");
  });
});
