import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReplicaStepper } from "../ReplicaStepper";

function Harness({ start = 3, current = 3, onChange }: { start?: number; current?: number; onChange?: (n: number) => void }) {
  const [v, setV] = useState(start);
  return (
    <ReplicaStepper
      value={v}
      current={current}
      onChange={(n) => {
        onChange?.(n);
        setV(n);
      }}
    />
  );
}
const field = () => screen.getByRole("spinbutton", { name: "Replicas" }) as HTMLInputElement;

describe("ReplicaStepper", () => {
  it("shows the count in a typeable number field", () => {
    render(<Harness />);
    expect(field().value).toBe("3");
    fireEvent.change(field(), { target: { value: "120" } });
    expect(field().value).toBe("120");
  });

  it("clamps typed negatives and junk at 0", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "-4" } });
    expect(field().value).toBe("0");
    fireEvent.change(field(), { target: { value: "" } });
    expect(field().value).toBe("0");
  });

  it("steps by 1 and by 5 with the buttons, and has no 10 buttons", () => {
    render(<Harness start={20} current={20} />);
    expect(screen.queryByRole("button", { name: "Increase replicas by 10" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decrease replicas by 10" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas by 5" }));
    expect(field().value).toBe("25");
    fireEvent.click(screen.getByRole("button", { name: "Decrease replicas by 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease replicas" }));
    expect(field().value).toBe("20");
  });

  it("Shift-click on + and − steps by 10", () => {
    render(<Harness start={20} current={20} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }), { shiftKey: true });
    expect(field().value).toBe("30");
    fireEvent.click(screen.getByRole("button", { name: "Decrease replicas" }), { shiftKey: true });
    expect(field().value).toBe("20");
  });

  it("Shift+arrow in the field steps by 10", () => {
    render(<Harness start={20} current={20} />);
    fireEvent.keyDown(field(), { key: "ArrowUp", shiftKey: true });
    expect(field().value).toBe("30");
    fireEvent.keyDown(field(), { key: "ArrowDown", shiftKey: true });
    expect(field().value).toBe("20");
  });

  it("never goes below 0 and disables the decrease buttons there", () => {
    render(<Harness start={4} current={4} />);
    fireEvent.click(screen.getByRole("button", { name: "Decrease replicas by 5" }));
    expect(field().value).toBe("0");
    expect(screen.getByRole("button", { name: "Decrease replicas" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease replicas by 5" })).toBeDisabled();
  });

  it("shows an Unsaved hint only while the count differs from the current one", () => {
    render(<Harness />);
    expect(screen.queryByText("Unsaved")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Decrease replicas" }));
    expect(screen.queryByText("Unsaved")).toBeNull();
  });
});
