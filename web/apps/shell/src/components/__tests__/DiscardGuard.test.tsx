import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useDiscardGuard } from "../DiscardGuard";
import { setEditDirty, resetEditGuard } from "../../lib/editGuard";

afterEach(resetEditGuard);

function Host({ onClose }: { onClose: () => void }) {
  const { guard, modal } = useDiscardGuard();
  return (
    <>
      <button onClick={guard(onClose)}>close</button>
      {modal}
    </>
  );
}

describe("useDiscardGuard", () => {
  it("runs the action straight away when nothing is dirty", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  it("asks first when an edit is dirty, and Keep editing drops nothing", () => {
    setEditDirty("x", true);
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  it("Escape on the dialog keeps the edit", () => {
    setEditDirty("x", true);
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Discard runs the action", () => {
    setEditDirty("x", true);
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
