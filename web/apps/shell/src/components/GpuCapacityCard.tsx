import { Badge, Card, DataTable, NsPill, Row, Stack } from "@kubebay/ui";
import type { GpuCapacity } from "../lib/gpuCapacity";

/** Roadmap Tier 2 #14 Phase 0: GPU capacity on Cost / Waste. Hidden entirely on clusters without GPU nodes. */
export function GpuCapacityCard({ gpu }: { gpu: GpuCapacity }) {
  if (gpu.totals.length === 0) return null;
  return (
    <Card>
      <Stack gap={3}>
        <Row align="center" gap={2} wrap>
          <strong>GPU capacity</strong>
          {gpu.totals.map((t) => (
            <Badge key={t.resource} tone={t.idle > 0 ? "warn" : "ok"}>
              {`${t.idle} of ${t.allocatable} ${t.resource} unclaimed`}
            </Badge>
          ))}
        </Row>
        <div className="muted small">
          Allocatable GPUs minus what scheduled pods ask for. No pod can use an unclaimed GPU until one asks for it.
          Utilisation of claimed GPUs needs DCGM metrics and isn't shown yet.
        </div>
        <DataTable
          rows={gpu.nodes}
          rowKey={(r) => `${r.node}/${r.resource}`}
          columns={[
            { key: "node", header: "Node", className: "mono small", render: (r) => r.node },
            { key: "resource", header: "Resource", className: "mono small", render: (r) => r.resource },
            { key: "claimed", header: "Claimed / allocatable", className: "mono small strong", render: (r) => `${r.requested} / ${r.allocatable}` },
          ]}
        />
        {gpu.pending.length > 0 && (
          <Stack gap={1}>
            <div className="small strong">
              {gpu.pending.length} pod{gpu.pending.length === 1 ? "" : "s"} waiting for a GPU
            </div>
            {gpu.pending.map((p) => (
              <Row key={`${p.namespace}/${p.pod}/${p.resource}`} align="center" gap={2}>
                <NsPill>{p.namespace}</NsPill>
                <span className="mono small">{p.pod}</span>
                <span className="muted small">
                  {p.count} × {p.resource}
                </span>
              </Row>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
