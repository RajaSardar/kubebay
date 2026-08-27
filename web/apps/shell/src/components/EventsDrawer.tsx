import { useMemo } from "react";
import { useResourceStream } from "../lib/useResourceStream";
import { fmtAge } from "../lib/resources";

export function EventsDrawer({
  cluster,
  namespace,
  name,
  kind,
}: {
  cluster: string | undefined;
  namespace: string;
  name: string;
  kind: string;
}) {
  const events = useResourceStream(cluster, "v1/events", { mode: "metadata" });

  const filtered = useMemo(() => {
    return events.rows
      .filter((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        const involved = (r.involvedObject ?? {}) as Record<string, unknown>;
        return (
          involved.name === name &&
          involved.kind === kind &&
          (!namespace || involved.namespace === namespace)
        );
      })
      .sort((a, b) => {
        const ra = (a ?? {}) as Record<string, unknown>;
        const rb = (b ?? {}) as Record<string, unknown>;
        const ma = (ra.metadata ?? {}) as Record<string, unknown>;
        const mb = (rb.metadata ?? {}) as Record<string, unknown>;
        return String(mb.creationTimestamp ?? "").localeCompare(String(ma.creationTimestamp ?? ""));
      });
  }, [events.rows, name, kind, namespace]);

  if (!filtered.length) {
    return <div className="muted small" style={{ padding: "12px 0" }}>No events for this {kind.toLowerCase()}.</div>;
  }

  return (
    <div className="events-drawer">
      {filtered.map((row, i) => {
        const r = (row ?? {}) as Record<string, unknown>;
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        const created = meta.creationTimestamp ? Date.parse(meta.creationTimestamp as string) : 0;
        const reason = (r.reason as string) ?? "";
        const message = (r.message as string) ?? "";
        const type = (r.type as string) ?? "";
        const count = (r.count as number) ?? 1;

        return (
          <div key={i} className={`events-row events-${type.toLowerCase()}`}>
            <div className="events-row-top">
              <span className={`events-type-badge ${type.toLowerCase()}`}>{type}</span>
              <span className="events-reason mono">{reason}</span>
              {count > 1 && <span className="events-count">×{count}</span>}
              <span className="muted small" style={{ marginLeft: "auto" }}>{fmtAge(Date.now() - created)}</span>
            </div>
            <div className="events-message">{message}</div>
          </div>
        );
      })}
    </div>
  );
}
