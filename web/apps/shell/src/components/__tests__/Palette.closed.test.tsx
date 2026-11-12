import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// Root #23: the palette is closed nearly all the time, but it turned every pod
// of the cluster into a search entry on every stream update. It reads pods only
// while it's open.

const reads = vi.hoisted(() => ({ n: 0 }));
const pod = vi.hoisted(
  () =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop === "string" && prop !== "then") reads.n++;
          return undefined;
        },
      },
    ),
);
vi.mock("../../lib/useResourceStream", async (orig) => ({
  ...(await orig<typeof import("../../lib/useResourceStream")>()),
  useResourceStream: () => ({ rows: [pod, pod, pod], synced: true, connected: true }),
}));
vi.mock("../../lib/cluster-store", async (orig) => {
  const actual = await orig<typeof import("../../lib/cluster-store")>();
  return { ...actual, useClusterStore: (sel: (s: { active: string }) => unknown) => sel({ active: "c1" }) };
});
const { Palette } = await import("../Palette");

function renderPalette(open: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Palette open={open} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Palette while closed", () => {
  it("doesn't read the cluster's pods", () => {
    reads.n = 0;
    renderPalette(false);
    expect(reads.n).toBe(0);
  });

  it("reads them once it opens", () => {
    reads.n = 0;
    renderPalette(true);
    expect(reads.n).toBeGreaterThan(0);
  });
});
