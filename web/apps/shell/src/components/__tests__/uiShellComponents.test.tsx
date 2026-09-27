import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ContextMenu,
  Kbd,
  NavItem,
  NavSection,
  PageHeader,
  Select,
  StatusPill,
  Tabs,
  TextField,
  phaseTone,
} from "@kubebay/ui";

describe("StatusPill", () => {
  it("shows the phase word with its tone class", () => {
    render(<StatusPill tone="err">CrashLoopBackOff</StatusPill>);
    const pill = screen.getByText("CrashLoopBackOff");
    expect(pill).toHaveClass("status-err");
  });

  it("maps pod phases to tones the way the Pods table does", () => {
    expect(phaseTone("Running")).toBe("ok");
    expect(phaseTone("Succeeded")).toBe("terminated");
    expect(phaseTone("Failed")).toBe("err");
    expect(phaseTone("Pending")).toBe("pending");
    expect(phaseTone("Terminating")).toBe("terminating");
    expect(phaseTone("Unknown")).toBeUndefined();
  });
});

describe("Tabs", () => {
  it("marks the active tab and reports clicks", () => {
    const onChange = vi.fn();
    render(
      <Tabs tabs={["yaml", "events"] as const} active="yaml" labels={{ yaml: "YAML", events: "Events" }} onChange={onChange} />,
    );
    expect(screen.getByRole("tab", { name: "YAML" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Events" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect(onChange).toHaveBeenCalledWith("events");
  });

  it("can render with another container class (drawer panes)", () => {
    const { container } = render(<Tabs tabs={["a"]} active="a" onChange={() => {}} className="drawer-pane-tabs" />);
    expect(container.firstChild).toHaveClass("drawer-pane-tabs");
    expect(container.firstChild).not.toHaveClass("tabs");
  });
});

describe("NavItem", () => {
  it("renders a link, marked current when active", () => {
    render(
      <nav>
        <NavSection>Navigate</NavSection>
        <NavItem href="#/pods" label="Pods" active />
        <NavItem href="#/jobs" label="Jobs" sub />
      </nav>,
    );
    expect(screen.getByText("Navigate")).toHaveClass("nav-section");
    const pods = screen.getByRole("link", { name: "Pods" });
    expect(pods).toHaveClass("nav-item", "active");
    expect(pods).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Jobs" })).toHaveClass("nav-item", "sub");
  });
});

describe("inputs", () => {
  it("TextField and Select use the toolbar control styles and pass props through", () => {
    const onChange = vi.fn();
    render(
      <>
        <TextField placeholder="Search pods…" onChange={onChange} />
        <Select aria-label="Namespace" defaultValue="b">
          <option value="a">a</option>
          <option value="b">b</option>
        </Select>
      </>,
    );
    const input = screen.getByPlaceholderText("Search pods…");
    expect(input).toHaveClass("toolbar-input");
    fireEvent.change(input, { target: { value: "api" } });
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByLabelText("Namespace")).toHaveClass("toolbar-select");
  });

  it("Kbd renders a keycap", () => {
    render(<Kbd>⌘K</Kbd>);
    expect(screen.getByText("⌘K").tagName).toBe("KBD");
  });
});

describe("PageHeader", () => {
  it("shows title, count and actions", () => {
    render(<PageHeader title="Pods" count="· 128" actions={<button>Reload</button>} />);
    expect(screen.getByRole("heading", { name: /Pods/ })).toBeInTheDocument();
    expect(screen.getByText("· 128")).toHaveClass("page-header-count");
    expect(screen.getByRole("button", { name: "Reload" }).parentElement).toHaveClass("page-header-actions");
  });
});

describe("ContextMenu", () => {
  const items = [
    { label: "View details", onClick: vi.fn() },
    { separator: true, label: "", onClick: () => {} },
    { label: "Delete", danger: true, onClick: vi.fn() },
    { label: "Evict", disabled: true, onClick: vi.fn() },
  ];

  it("runs an item and closes", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items} onClose={onClose} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(items[2]!.onClick).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveClass("ctx-item", "danger");
  });

  it("ignores disabled items and closes on Escape or an outside click", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items} onClose={onClose} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Evict" }));
    expect(items[3]!.onClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
