import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useAgeLabel } from "../tableUx";

// Ages in tables were computed at render, and rows only re-render when their
// data changes, so a pod created "5s" ago still read "5s" a minute later.
describe("useAgeLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps counting while the row's data stays the same", () => {
    const { result } = renderHook(() => useAgeLabel("2026-09-29T11:59:55Z"));
    expect(result.current).toBe("5s");
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toBe("8s");
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe("1m");
  });

  it("re-renders a cell only when its text changes", () => {
    let renders = 0;
    function Cell() {
      renders++;
      return <span>{useAgeLabel("2026-09-29T10:00:00Z")}</span>;
    }
    render(<Cell />);
    const before = renders;
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByText("2h")).toBeInTheDocument();
    expect(renders).toBe(before);
  });

  it("shares one timer across every cell, and stops it when the last one goes", () => {
    const set = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval");
    function Cells() {
      return (
        <>
          {Array.from({ length: 200 }, (_, i) => (
            <Cell key={i} />
          ))}
        </>
      );
    }
    function Cell() {
      return <span>{useAgeLabel("2026-09-29T11:00:00Z")}</span>;
    }
    const { unmount } = render(<Cells />);
    expect(set).toHaveBeenCalledTimes(1);
    unmount();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("shows nothing for a missing or unreadable time", () => {
    expect(renderHook(() => useAgeLabel(undefined)).result.current).toBe("");
    expect(renderHook(() => useAgeLabel("not a date")).result.current).toBe("");
  });
});

describe("tables use the live age", () => {
  it("Pods and every resource table render Age through LiveAge, not a one-off fmtAge", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const page of ["Workloads.tsx", "ResourceTable.tsx"]) {
      const src = readFileSync(resolve(__dirname, "../../pages", page), "utf8");
      expect(src, page).toMatch(/<LiveAge\b/);
      expect(src, page).not.toMatch(/>\{fmtAge\(/);
    }
  });
});
