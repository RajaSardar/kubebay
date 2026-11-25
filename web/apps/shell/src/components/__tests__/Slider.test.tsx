import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Slider } from "@kubebay/ui";

const slider = () => screen.getByRole("slider", { name: "Replicas" }) as HTMLInputElement;

describe("Slider", () => {
  it("is a native range with a name, a range and a spoken value", () => {
    render(<Slider label="Replicas" value={400} min={0} max={1000} valueText="10 replicas, 2 more than now" onChange={() => {}} />);
    expect(slider().tagName).toBe("INPUT");
    expect(slider()).toHaveAttribute("type", "range");
    expect(slider()).toHaveAttribute("min", "0");
    expect(slider()).toHaveAttribute("max", "1000");
    expect(slider()).toHaveValue("400");
    expect(slider()).toHaveAttribute("aria-valuetext", "10 replicas, 2 more than now");
  });

  it("emits one onChange per input event, with a number", () => {
    const onChange = vi.fn();
    render(<Slider label="Replicas" value={0} max={1000} onChange={onChange} />);
    fireEvent.change(slider(), { target: { value: "250" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(250);
  });

  it("never emits on its own: a value past the max is pinned and written only by a real input", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Slider label="Replicas" value={5000} max={1000} onChange={onChange} />);
    rerender(<Slider label="Replicas" value={5000} max={1000} onChange={onChange} />);
    fireEvent.focus(slider());
    fireEvent.blur(slider());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hands arrow keys to onStep (Shift is the big step) and does not move on its own", () => {
    const onChange = vi.fn();
    const onStep = vi.fn();
    render(<Slider label="Replicas" value={400} max={1000} onChange={onChange} onStep={onStep} />);
    expect(fireEvent.keyDown(slider(), { key: "ArrowRight" })).toBe(false); // default prevented
    fireEvent.keyDown(slider(), { key: "ArrowUp" });
    fireEvent.keyDown(slider(), { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(slider(), { key: "ArrowDown" });
    expect(onStep.mock.calls).toEqual([
      [1, false],
      [1, false],
      [-1, true],
      [-1, false],
    ]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves other keys (PageUp, Home, End) to the browser", () => {
    const onStep = vi.fn();
    render(<Slider label="Replicas" value={400} max={1000} onChange={() => {}} onStep={onStep} />);
    expect(fireEvent.keyDown(slider(), { key: "Home" })).toBe(true);
    expect(fireEvent.keyDown(slider(), { key: "PageUp" })).toBe(true);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("can be disabled", () => {
    render(<Slider label="Replicas" value={0} max={1000} disabled onChange={() => {}} />);
    expect(slider()).toBeDisabled();
  });
});
