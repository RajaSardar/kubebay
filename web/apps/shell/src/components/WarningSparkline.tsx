import { useId, useMemo, type CSSProperties } from "react";
import { Row, Stack } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";
import { workloadWarnings, type WorkloadWarnings } from "../lib/workloadWarnings";

const W = 240;
const H = 32;
const GAP = 2;

function minutesAgo(t: number) {
  return Math.max(0, Math.round((Date.now() - t) / 60_000));
}

function summary(w: WorkloadWarnings): string {
  const count = `${w.total} warning${w.total === 1 ? "" : "s"}`;
  if (w.onset === "all hour") return `${count} · going on all hour`;
  if (w.onset === "new") return `${count} · new, first ${minutesAgo(w.firstAt)} min ago`;
  return `${count} · started ${minutesAgo(w.firstAt)} min ago`;
}

/**
 * Overview v2, in the workload drawer: is this problem new or has it been
 * going on? The workload's warning events (its own, its pods' and, for a
 * Deployment, its ReplicaSets') over the last hour, which is as long as
 * events live, in twelve zero-based 5-minute bars with the answer in words.
 * Renders nothing when there were no warnings.
 */
export function WarningSparkline({ cluster, obj, style }: { cluster: string; obj: Record<string, unknown> | null; style?: CSSProperties }) {
  const id = useId();
  const ns = String((obj?.metadata as Record<string, unknown> | undefined)?.namespace ?? "");
  const events = useResourceStream(cluster, "v1/events", { ns: ns ? [ns] : undefined, mode: "full", enabled: !!obj });
  const pods = useResourceStream(cluster, "v1/pods", { ns: ns ? [ns] : undefined, mode: "metadata", enabled: !!obj });
  const w = useMemo(() => (obj ? workloadWarnings(events.rows, pods.rows, obj) : null), [events.rows, pods.rows, obj]);
  if (!w) return null;

  const max = Math.max(1, ...w.buckets);
  const bw = (W - GAP * (w.buckets.length - 1)) / w.buckets.length;
  return (
    <section aria-labelledby={id} style={style}>
      <Stack gap={1}>
        <Row gap={2} align="baseline" wrap>
          <strong id={id} className="small">
            Warnings, last hour
          </strong>
          <span className="small">{summary(w)}</span>
        </Row>
        <Row gap={2} align="end">
          <svg
            role="img"
            aria-label={`Warnings per 5 minutes over the last hour, oldest first: ${w.buckets.join(", ")}`}
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
          >
            {w.buckets.map((n, i) => {
              const h = n === 0 ? 1 : Math.max(2, (n / max) * H);
              return (
                <rect
                  key={i}
                  data-count={n}
                  x={i * (bw + GAP)}
                  y={H - h}
                  width={bw}
                  height={h}
                  rx={1}
                  fill={n === 0 ? "var(--kb-border-subtle)" : "var(--kb-status-warn)"}
                >
                  <title>{`${60 - i * 5}–${55 - i * 5} min ago: ${n}`}</title>
                </rect>
              );
            })}
          </svg>
          <Stack gap={0} className="muted small">
            <span className="mono">{`max ${max}`}</span>
            <span>60 min ago → now</span>
          </Stack>
        </Row>
      </Stack>
    </section>
  );
}
