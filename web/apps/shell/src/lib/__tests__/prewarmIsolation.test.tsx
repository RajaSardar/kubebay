/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Root #23: the background streams (pods, events, workloads…) update many
// times a second on a busy cluster. Held in the app's root component, every
// update re-rendered the sidebar, the cluster strip, the palette and the page.
// They live in a component of their own that renders nothing.

const bump: (() => void)[] = [];
vi.mock("../useResourceStream", async () => {
  const { useState } = await import("react");
  return {
    useResourceStream: () => {
      const [, set] = useState(0);
      bump.push(() => set((n) => n + 1));
      return { rows: [], synced: false };
    },
  };
});
const { Prewarm } = await import("../usePrewarm");

describe("Prewarm", () => {
  it("takes stream updates without re-rendering what sits beside it", () => {
    let siblingRenders = 0;
    function Sibling() {
      siblingRenders++;
      return null;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Prewarm cluster="c1" />
        <Sibling />
      </QueryClientProvider>,
    );
    expect(bump.length).toBeGreaterThan(0);
    act(() => bump.forEach((b) => b()));
    expect(siblingRenders).toBe(1);
  });

  it("is rendered by the app, not called as a hook in its root", () => {
    const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8");
    expect(app).not.toMatch(/usePrewarm\(/);
    expect(app).toMatch(/<Prewarm cluster=/);
  });
});
