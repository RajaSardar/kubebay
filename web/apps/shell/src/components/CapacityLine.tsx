import { useId, useState } from "react";
import { Button, Row, Stack, StatusPill } from "@kubebay/ui";
import { fmtBytes, fmtCpu } from "../lib/format";
import type { CapacityResource, ClusterCapacity } from "../lib/capacity";

function barText(label: string, r: CapacityResource, fmt: (n: number) => string): string {
  const used = r.used !== undefined ? ` · ${fmt(r.used)} used` : "";
  return `${label}: ${fmt(r.requested)} of ${fmt(r.allocatable)} requested${used}`;
}

/** A zero-based bullet bar: allocatable is the track, requested the fill, used a thinner bar inside. */
function Bullet({ r, text }: { r: CapacityResource; text: string }) {
  const pct = (n: number) => `${Math.min(100, r.allocatable > 0 ? (n / r.allocatable) * 100 : 0)}%`;
  return (
    <Stack gap={1}>
      <span className="small">{text}</span>
      <div
        role="img"
        aria-label={text}
        style={{ position: "relative", height: 10, borderRadius: "var(--kb-radius-xs)", background: "var(--kb-bg-inset)", overflow: "hidden" }}
      >
        <div style={{ height: "100%", width: pct(r.requested), background: r.over ? "var(--kb-status-warn)" : "var(--kb-accent)" }} />
        {r.used !== undefined && (
          <div style={{ position: "absolute", left: 0, top: 3, height: 4, width: pct(r.used), background: "var(--kb-fg-default)" }} />
        )}
      </div>
    </Stack>
  );
}

/**
 * Overview v2's capacity line: one sentence of how much of the cluster is
 * requested, opening into bullet bars. Requests need no metrics-server, so it
 * shows on every cluster; nothing is drawn without nodes to measure.
 */
export function CapacityLine({ capacity }: { capacity: ClusterCapacity | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!capacity) return null;
  const { cpu, memory } = capacity;
  return (
    <section aria-labelledby={id}>
      <Stack gap={2}>
        <Row gap={2} align="center" wrap>
          <strong id={id}>Capacity</strong>
          <span className="muted small">{`CPU ${cpu.pct}% · memory ${memory.pct}% requested of allocatable`}</span>
          {cpu.over && <StatusPill tone="warn">CPU is nearly full</StatusPill>}
          {memory.over && <StatusPill tone="warn">Memory is nearly full</StatusPill>}
          <Button variant="ghost" aria-expanded={open} aria-controls={`${id}-bars`} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide bars" : "Show bars"}
          </Button>
        </Row>
        {open && (
          <Stack gap={3} id={`${id}-bars`}>
            <Bullet r={cpu} text={barText("CPU", cpu, fmtCpu)} />
            <Bullet r={memory} text={barText("Memory", memory, fmtBytes)} />
          </Stack>
        )}
      </Stack>
    </section>
  );
}
