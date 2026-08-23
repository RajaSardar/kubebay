import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@kubebay/ui";
import { api } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";

interface EventRow {
  key: string;
  ts: number;
  type: string;
  reason: string;
  message: string;
  obj: string;
  count: number;
}

function asRecord(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function deriveEvent(obj: Record<string, unknown>): EventRow | null {
  const meta = asRecord(obj.metadata);
  const name = meta.name as string | undefined;
  if (!name) return null;

  const involved = asRecord(obj.involvedObject);
  const kind = (involved.kind as string) ?? "";
  const ns = (involved.namespace as string) ?? "";
  const objName = (involved.name as string) ?? "";
  const last = (obj.lastTimestamp as string) || (obj.eventTime as string) || (meta.creationTimestamp as string) || "";

  return {
    key: `${ns}/${name}`,
    ts: last ? Date.parse(last) : 0,
    type: (obj.type as string) ?? "Normal",
    reason: (obj.reason as string) ?? "",
    message: (obj.message as string) ?? "",
    obj: [kind, ns ? `${ns}/${objName}` : objName].filter(Boolean).join(" "),
    count: (obj.count as number) ?? 1,
  };
}

export default function Timeline() {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const [clusterId, setClusterId] = useState("");
  const [filter, setFilter] = useState("");
  const [warningsOnly, setWarningsOnly] = useState(false);

  const list = clusters.data ?? [];
  const effectiveCluster = clusterId || list.find((c) => c.status === "connected")?.id || list[0]?.id || "";

  const { rows, synced, connected } = useResourceStream(effectiveCluster || undefined, "v1/events", { mode: "full" });

  const events = useMemo(() => {
    const out = rows
      .map(deriveEvent)
      .filter((e): e is EventRow => e !== null)
      .filter((e) => !filter || e.message.includes(filter) || e.reason.includes(filter) || e.obj.includes(filter))
      .filter((e) => !warningsOnly || e.type === "Warning")
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 500);
    return out;
  }, [rows, filter, warningsOnly]);

  const warnCount = useMemo(() => events.filter((e) => e.type === "Warning").length, [events]);

  function fmtRel(ms: number): string {
    if (!ms) return "–";
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 5) return "now";
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          Timeline
          {synced && connected && (
            <span className="live-pill">
              ● live
            </span>
          )}
        </h2>
        <Badge tone={warnCount > 0 ? "err" : "ok"}>{warnCount} warnings</Badge>
      </div>

      <div className="toolbar">
        <select
          className="toolbar-select"
          value={effectiveCluster}
          onChange={(e) => setClusterId(e.target.value)}
        >
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}
            </option>
          ))}
        </select>
        <input
          className="toolbar-input"
          placeholder="Filter message / reason / object…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <label className="ctl" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={warningsOnly} onChange={(e) => setWarningsOnly(e.target.checked)} />
          warnings only
        </label>
        <Badge>{events.length}</Badge>
      </div>

      {!synced ? (
        <p className="muted">Connecting to event stream…</p>
      ) : events.length === 0 ? (
        <div className="empty-state">
          <p>No events match.</p>
          <p className="muted small">{filter || warningsOnly ? "Loosen the filters." : "A quiet cluster is a happy cluster."}</p>
        </div>
      ) : (
        <div className="timeline-list">
          {events.map((e) => {
            const isWarn = e.type === "Warning";
            return (
              <div key={e.key} className={`tl-item${isWarn ? " tl-warn" : ""}`}>
                <span className={`tl-dot ${isWarn ? "warn" : ""}`} />
                <div className="tl-body">
                  <div className="tl-top">
                    <span className="mono strong">{e.reason}</span>
                    {isWarn && <Badge tone="err">warning</Badge>}
                    {e.count > 1 && <Badge>×{e.count}</Badge>}
                    <span className="muted small mono">{e.obj}</span>
                    <span className="muted small" style={{ marginLeft: "auto", flexShrink: 0 }}>
                      {fmtRel(e.ts)}
                    </span>
                  </div>
                  <div className="tl-msg small muted">{e.message}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
