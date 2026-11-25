import { getToken } from "./api";
import { DETECTOR_LABEL, type Issue } from "./issues";

/**
 * Backlog 78: "Investigate with AI" hands a problem to the user's own Claude
 * Code on this computer. This file is the request building, the event stream
 * parsing and the engine calls; the engine decides everything that matters
 * (the tools Claude Code gets, the limits, who may run it).
 */

export type AiState = "ready" | "off-by-user" | "locked" | "no-claude" | "notice-needed";

export interface AiStatus {
  state: AiState;
  enabled: boolean;
  reason?: string;
  installHelp?: string;
  notice?: string;
  noticeVersion: number;
  claudePath?: string;
  limits: { seconds: number; bytes: number };
}

export interface InvestigationRequest {
  cluster: string;
  namespace?: string;
  kind?: string;
  name?: string;
  issueId?: string;
  title?: string;
  detail?: string;
}

/** What goes to the engine for an Issue: its own wording and where it is. */
export function requestFromIssue(i: Issue): InvestigationRequest {
  return {
    cluster: i.cluster,
    namespace: i.namespace || undefined,
    kind: i.kind,
    name: i.name,
    issueId: i.id,
    title: i.summary,
    detail: `${DETECTOR_LABEL[i.detector]}: ${i.code}`,
  };
}

/** What goes to the engine for an object opened in a drawer. */
export function requestFromObject(o: { cluster: string; namespace?: string; kind: string; name: string }): InvestigationRequest {
  return {
    cluster: o.cluster,
    namespace: o.namespace || undefined,
    kind: o.kind,
    name: o.name,
    title: `Find out what is wrong with ${o.kind} ${o.name}, if anything.`,
  };
}

export interface AiEvent {
  kind: "text" | "tool" | "notice" | "end";
  text?: string;
}

/** Splits an event stream into whole events and the unfinished tail. */
export function parseSse(buf: string): { events: AiEvent[]; rest: string } {
  const parts = buf.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: AiEvent[] = [];
  for (const p of parts) {
    for (const line of p.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const e = JSON.parse(line.slice(6)) as AiEvent;
        if (e && typeof e.kind === "string") events.push(e);
      } catch {
        /* not ours */
      }
    }
  }
  return { events, rest };
}

export interface RunView {
  text: string;
  tools: string[];
  notices: string[];
  outcome?: string;
  bytes: number;
}

export function emptyRun(): RunView {
  return { text: "", tools: [], notices: [], bytes: 0 };
}

export function reduceRun(v: RunView, e: AiEvent): RunView {
  const t = e.text ?? "";
  switch (e.kind) {
    case "text":
      return { ...v, text: v.text + t, bytes: v.bytes + t.length };
    case "tool":
      return { ...v, tools: [...v.tools, t.replace(/^mcp__kubebay__/, "")] };
    case "notice":
      return { ...v, notices: [...v.notices, t] };
    case "end":
      return { ...v, outcome: t };
  }
}

export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "done":
      return "Finished";
    case "stopped":
      return "Stopped by you";
    case "timeout":
      return "Stopped: the time limit was reached";
    case "limit":
      return "Stopped: the size limit was reached";
    default:
      return "The run failed";
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Kubebay-Token": getToken() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const aiApi = {
  status: () => call<AiStatus>("GET", "/api/ai/status"),
  acceptNotice: (version: number) => call<AiStatus>("POST", "/api/ai/notice", { version }),
  setEnabled: (enabled: boolean) => call<AiStatus>("POST", "/api/ai/settings", { enabled }),
  start: (r: InvestigationRequest) => call<{ id: string }>("POST", "/api/ai/investigations", r),
  stop: (id: string) => call<void>("DELETE", `/api/ai/investigations/${encodeURIComponent(id)}`),
  /** Streams events until the run ends or the signal aborts (which also stops the run engine-side). */
  async stream(id: string, onEvent: (e: AiEvent) => void, signal: AbortSignal): Promise<void> {
    const res = await fetch(`/api/ai/investigations/${encodeURIComponent(id)}/events`, { headers: { "X-Kubebay-Token": getToken() }, signal });
    if (!res.ok || !res.body) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { events, rest } = parseSse(buf);
      buf = rest;
      events.forEach(onEvent);
    }
  },
};
