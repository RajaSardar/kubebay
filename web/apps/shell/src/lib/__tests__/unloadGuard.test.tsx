import { afterEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { setEditDirty, resetEditGuard } from "../editGuard";
import { useUnloadGuard } from "../unloadGuard";

// Backlog 51 phase 3: closing or reloading the window with a dirty editor asks first.
function Host() {
  useUnloadGuard();
  return null;
}
const unload = () => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e;
};
afterEach(() => resetEditGuard());

describe("useUnloadGuard", () => {
  it("lets the window close when nothing is dirty", () => {
    render(<Host />);
    expect(unload().defaultPrevented).toBe(false);
  });

  it("asks before the window closes while any editor is dirty", () => {
    render(<Host />);
    act(() => setEditDirty("a", true));
    expect(unload().defaultPrevented).toBe(true);
    act(() => setEditDirty("a", false));
    expect(unload().defaultPrevented).toBe(false);
  });

  it("stops asking once unmounted", () => {
    const { unmount } = render(<Host />);
    act(() => setEditDirty("a", true));
    unmount();
    expect(unload().defaultPrevented).toBe(false);
  });
});
