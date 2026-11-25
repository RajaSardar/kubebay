import { describe, it, expect, vi } from "vitest";
import { useState, memo } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ReplicaControl } from "../ReplicaControl";
import { positionFromReplica, replicaFromPosition, sliderMax } from "../../lib/replicaScale";

function Harness({
  start,
  current = 3,
  inline,
  onChange,
  onEnter,
  statefulSet,
}: {
  start?: number;
  current?: number;
  inline?: boolean;
  onChange?: (n: number) => void;
  onEnter?: () => void;
  statefulSet?: boolean;
}) {
  const [v, setV] = useState(start ?? current);
  return (
    <ReplicaControl
      value={v}
      current={current}
      inline={inline}
      statefulSet={statefulSet}
      onEnter={onEnter}
      onChange={(n) => {
        onChange?.(n);
        setV(n);
      }}
    />
  );
}
const field = () => screen.getByRole("spinbutton", { name: "Replicas" }) as HTMLInputElement;
const slider = () => screen.getByRole("slider", { name: "Replicas" }) as HTMLInputElement;
const open = () => fireEvent.click(screen.getByRole("button", { name: /^Scale:/ }));

describe("ReplicaControl (popover)", () => {
  it("is one button reading the count, and the panel is closed", () => {
    render(<Harness current={18} />);
    expect(screen.getByRole("button", { name: /^Scale: 18$/ })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("reads 'Scale: 18 → 24' while the draft differs, and keeps the draft when the panel closes", () => {
    render(<Harness current={18} />);
    open();
    fireEvent.change(field(), { target: { value: "24" } });
    expect(screen.getByRole("button", { name: /^Scale: 18 → 24$/ })).toBeInTheDocument();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByRole("button", { name: /^Scale: 18 → 24$/ })).toBeInTheDocument();
    open();
    expect(field().value).toBe("24");
  });

  it("types an exact number, clamping negatives and junk at 0", () => {
    render(<Harness />);
    open();
    fireEvent.change(field(), { target: { value: "120" } });
    expect(field().value).toBe("120");
    fireEvent.change(field(), { target: { value: "-4" } });
    expect(field().value).toBe("0");
    fireEvent.change(field(), { target: { value: "" } });
    expect(field().value).toBe("0");
  });

  it("shows the live label and the Unsaved badge only while the draft differs", () => {
    render(<Harness current={18} />);
    open();
    expect(screen.getByText("No change")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).toBeNull();
    fireEvent.change(field(), { target: { value: "24" } });
    expect(screen.getByText("18 → 24 (+6)")).toBeInTheDocument();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: "10" } });
    expect(screen.getByText("18 → 10 (−8)")).toBeInTheDocument();
  });

  it("Reset to N puts the draft back, and only shows while dirty", () => {
    render(<Harness current={18} />);
    open();
    expect(screen.queryByRole("button", { name: "Reset to 18" })).toBeNull();
    fireEvent.change(field(), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to 18" }));
    expect(field().value).toBe("18");
    expect(screen.queryByRole("button", { name: "Reset to 18" })).toBeNull();
  });

  it("chips set the draft, show pressed, and 0 is labelled, not only coloured", () => {
    render(<Harness current={18} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "0 (stop)" }));
    expect(field().value).toBe("0");
    expect(screen.getByRole("button", { name: "0 (stop)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Half (9)" }));
    expect(field().value).toBe("9");
    fireEvent.click(screen.getByRole("button", { name: "2× (36)" }));
    expect(field().value).toBe("36");
    fireEvent.click(screen.getByRole("button", { name: "Current (18)" }));
    expect(field().value).toBe("18");
  });

  it("has no duplicate chips when the live count equals a preset", () => {
    render(<Harness current={2} />);
    open();
    const chips = within(screen.getByRole("dialog")).getAllByRole("button", { pressed: false }).concat(within(screen.getByRole("dialog")).queryAllByRole("button", { pressed: true }));
    const names = chips.map((b) => b.textContent);
    expect(new Set(names).size).toBe(names.length);
  });

  it("the slider is a native range over positions and moves the draft by replica", () => {
    const onChange = vi.fn();
    render(<Harness current={18} onChange={onChange} />);
    open();
    const max = sliderMax(18);
    expect(slider()).toHaveAttribute("type", "range");
    expect(slider()).toHaveValue(String(positionFromReplica(18, max)));
    fireEvent.change(slider(), { target: { value: String(positionFromReplica(30, max)) } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(replicaFromPosition(positionFromReplica(30, max), max));
    expect(slider()).toHaveAttribute("aria-valuetext", expect.stringMatching(/more than now/));
  });

  it("arrow keys on the slider step one replica, Shift ten, without skipping any", () => {
    render(<Harness current={50} />);
    open();
    fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(field().value).toBe("51");
    fireEvent.keyDown(slider(), { key: "ArrowLeft", shiftKey: true });
    expect(field().value).toBe("41");
    fireEvent.keyDown(slider(), { key: "ArrowDown" });
    expect(field().value).toBe("40");
  });

  it("a draft above the slider max pins the thumb and nothing is written until it is dragged", () => {
    const onChange = vi.fn();
    render(<Harness current={3} start={5000} onChange={onChange} />);
    open();
    expect(slider()).toHaveValue("1000");
    expect(field().value).toBe("5000");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enter in the number box hands off to onEnter (the row's Apply) and nothing else changes", () => {
    const onEnter = vi.fn();
    const onChange = vi.fn();
    render(<Harness onEnter={onEnter} onChange={onChange} />);
    open();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("warns when the draft is 0, and notes StatefulSet ordinals", () => {
    render(<Harness current={3} statefulSet />);
    open();
    expect(screen.queryByText(/highest ordinals/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getByText(/highest ordinals/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "0 (stop)" }));
    expect(screen.getByText(/no pods will run/i)).toBeInTheDocument();
  });

  it("is disabled as a whole while busy", () => {
    render(<ReplicaControl value={3} current={3} onChange={() => {}} disabled />);
    expect(screen.getByRole("button", { name: /^Scale:/ })).toBeDisabled();
  });

  it("a drag is one onChange per input event and does not re-render a sibling", () => {
    let renders = 0;
    const Sibling = memo(function Sibling() {
      renders++;
      return <span>sibling</span>;
    });
    function Host() {
      const [v, setV] = useState(18);
      return (
        <>
          <Sibling />
          <ReplicaControl value={v} current={18} onChange={setV} />
        </>
      );
    }
    render(<Host />);
    open();
    const before = renders;
    for (const p of [300, 420, 600, 800]) fireEvent.change(slider(), { target: { value: String(p) } });
    expect(renders).toBe(before);
  });

  it("the panel is the fixed 280px class, with wrapping chips (fits the narrowest drawer)", () => {
    render(<Harness current={18} />);
    open();
    expect(screen.getByRole("dialog")).toHaveClass("kb-popover-panel");
    expect(screen.getByTestId("replica-chips")).toHaveClass("kb-wrap");
  });
});

describe("ReplicaControl (inline, for the Scale dialog)", () => {
  it("renders the body in place with no popover button", () => {
    render(<Harness current={18} inline />);
    expect(screen.queryByRole("button", { name: /^Scale:/ })).toBeNull();
    expect(field().value).toBe("18");
    fireEvent.change(field(), { target: { value: "24" } });
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByText("18 → 24 (+6)")).toBeInTheDocument();
  });

  it("does not intercept Enter, so the dialog form owns it", () => {
    const onEnter = vi.fn();
    render(<Harness inline onEnter={onEnter} />);
    expect(fireEvent.keyDown(field(), { key: "Enter" })).toBe(true);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("reserves room for the widest label a drag can reach, so the row does not shift while dragging", () => {
    render(<Harness current={100} />);
    const btn = screen.getByRole("button", { name: /^Scale:/ });
    const label = btn.querySelector(".mono") as HTMLElement;
    const widest = `Scale: 100 \u2192 ${sliderMax(100)}`;
    expect(parseFloat(label.style.minWidth)).toBeGreaterThanOrEqual(widest.length);
  });
});
