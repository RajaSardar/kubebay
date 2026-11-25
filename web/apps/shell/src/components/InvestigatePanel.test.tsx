import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AiEvent, AiStatus } from "../lib/aiInvestigate";

const status = (over: Partial<AiStatus>): AiStatus => ({
  state: "ready",
  enabled: true,
  noticeVersion: 1,
  notice: "Claude Code sends this to Anthropic under your account.",
  limits: { seconds: 300, bytes: 262144 },
  ...over,
});

const h = vi.hoisted(() => {
  const st = {
    current: null as unknown as AiStatus,
    emitted: [] as AiEvent[],
    hold: null as Promise<void> | null,
  };
  const api = {
    status: vi.fn(async () => st.current),
    acceptNotice: vi.fn(async () => {
      st.current = { ...st.current, state: "ready" };
      return st.current;
    }),
    setEnabled: vi.fn(),
    start: vi.fn(async (_r: unknown) => ({ id: "ai-1" })),
    stop: vi.fn(async (_id: string) => undefined),
    stream: vi.fn(async (_id: string, onEvent: (e: AiEvent) => void) => {
      st.emitted.forEach(onEvent);
      if (st.hold) await st.hold;
    }),
  };
  return Object.assign(st, { api });
});
const api = h.api;
h.current = status({});
vi.mock("../lib/aiInvestigate", async (orig) => ({ ...(await orig<typeof import("../lib/aiInvestigate")>()), aiApi: h.api }));

import { InvestigateButton } from "./InvestigatePanel";

const request = { cluster: "c1", namespace: "prod", kind: "Pod", name: "web-1", title: "Restarting" };

function open(onOpenObject = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <InvestigateButton request={request} onOpenObject={onOpenObject} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Investigate with AI/ }));
  return onOpenObject;
}

beforeEach(() => {
  h.current = status({});
  h.emitted = [];
  h.hold = null;
  Object.values(api).forEach((f) => f.mockClear());
});

describe("InvestigatePanel", () => {
  it("explains how to install Claude Code and runs nothing when it is missing", async () => {
    h.current = status({ state: "no-claude", installHelp: "Claude Code was not found on this computer. Install it from https://docs.claude.com." });
    open();
    expect(await screen.findByText(/was not found on this computer/)).toBeTruthy();
    expect(api.start).not.toHaveBeenCalled();
  });

  it("shows the reason on a shared engine and runs nothing", async () => {
    h.current = status({ state: "locked", reason: "AI investigations are off here: the MCP server is off in in-cluster mode" });
    open();
    expect(await screen.findByText(/off in in-cluster mode/)).toBeTruthy();
    expect(api.start).not.toHaveBeenCalled();
  });

  it("says it is turned off when the user turned it off", async () => {
    h.current = status({ state: "off-by-user", enabled: false });
    open();
    expect(await screen.findByText(/turned off in Settings/)).toBeTruthy();
    expect(api.start).not.toHaveBeenCalled();
  });

  it("asks for the first-run notice, and declining starts nothing", async () => {
    h.current = status({ state: "notice-needed" });
    open();
    expect(await screen.findByText(/Anthropic under your account/)).toBeTruthy();
    expect(api.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.acceptNotice).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });

  it("accepting the notice records it once, then starts", async () => {
    h.current = status({ state: "notice-needed" });
    h.emitted = [{ kind: "end", text: "done" }];
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Accept and investigate/ }));
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    expect(api.acceptNotice).toHaveBeenCalledWith(1);
  });

  it("streams the answer as plain text and offers the object, not an apply button", async () => {
    h.emitted = [
      { kind: "tool", text: "mcp__kubebay__get_logs" },
      { kind: "text", text: "The image tag <b>latest</b> does not exist." },
      { kind: "end", text: "done" },
    ];
    const onOpen = open();
    expect(await screen.findByText(/does not exist/)).toBeTruthy();
    expect(document.querySelector("b")).toBeNull(); // text, never HTML
    expect(screen.getByText(/get_logs/)).toBeTruthy();
    expect(screen.getByText("Finished")).toBeTruthy();
    expect(api.start).toHaveBeenCalledWith(request);
    expect(screen.queryByRole("button", { name: /^apply/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open the object/ }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("Stop asks the engine to stop the run", async () => {
    h.hold = new Promise(() => undefined);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith("ai-1"));
  });
});
