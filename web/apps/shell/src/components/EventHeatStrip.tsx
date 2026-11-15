import { buildWarningHeatStrip, type WarningEventForHeat } from "../lib/eventHeatStrip";

/**
 * A compact horizontal intensity strip of warning-event activity over the
 * last hour. Deliberately not 24h: the API server's default event TTL means
 * anything older is already gone from the stream, so a longer axis would be
 * dishonest about what it's actually showing.
 */
export function EventHeatStrip({ events, now }: { events: WarningEventForHeat[]; now?: number }) {
  const buckets = buildWarningHeatStrip(events, now !== undefined ? { now } : undefined);
  const max = Math.max(1, ...buckets.map((b) => b.value));

  return (
    <div className="heat-strip">
      <div className="heat-strip-bars" role="img" aria-label="Warning event activity over the last hour">
        {buckets.map((b, i) => {
          const count = Math.round(b.value);
          return (
            <div
              key={i}
              className="heat-strip-bar"
              style={{ opacity: b.value > 0 ? Math.max(0.15, b.value / max) : 0 }}
              title={
                count > 0
                  ? `${count} warning${count === 1 ? "" : "s"} around ${new Date(b.start).toLocaleTimeString()}`
                  : undefined
              }
            />
          );
        })}
      </div>
      <div className="heat-strip-axis">
        <span className="muted small">1h ago</span>
        <span className="muted small">now</span>
      </div>
    </div>
  );
}
