import { useQuery } from "@tanstack/react-query";
import { Badge, Card, DataTable, InlineBanner, NsPill, Row, SkeletonLines, Stack, type BadgeTone } from "@kubebay/ui";
import { promApi, PromNotConfiguredError } from "../lib/api";
import type { GpuPod } from "../lib/gpuCapacity";
import {
  GPU_UTIL_QUERIES,
  MIN_HOURS,
  UNDERUSED_AVG,
  UNDERUSED_PEAK,
  summarizeGpuUtilisation,
  type GpuQueryKey,
  type GpuQueryResults,
  type GpuUtilRow,
  type GpuVerdict,
} from "../lib/gpuUtilisation";

const VERDICT: Record<GpuVerdict, { label: string; tone?: BadgeTone }> = {
  underused: { label: "underused", tone: "warn" },
  busy: { label: "in use", tone: "ok" },
  "too-little-data": { label: "too little data" },
  "no-data": { label: "no DCGM data" },
};

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const gib = (mib: number) => (mib / 1024).toFixed(1);

async function fetchAll(cluster: string): Promise<GpuQueryResults> {
  const keys = Object.keys(GPU_UTIL_QUERIES) as GpuQueryKey[];
  const results = await Promise.all(keys.map((k) => promApi.query({ cluster, query: GPU_UTIL_QUERIES[k] })));
  return Object.fromEntries(keys.map((k, i) => [k, results[i] ?? []])) as GpuQueryResults;
}

/**
 * Backlog #40 Phase 1, below GPU capacity on Cost / Waste: how busy the
 * claimed NVIDIA GPUs actually are, from the DCGM exporter in the cluster's
 * Prometheus. Read-only; a suggestion, never an action.
 */
export function GpuUtilisationCard({ cluster, pods }: { cluster: string; pods: GpuPod[] }) {
  const q = useQuery({
    queryKey: ["gpu-utilisation", cluster],
    queryFn: () => fetchAll(cluster),
    enabled: !!cluster,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const summary = q.data ? summarizeGpuUtilisation(pods, q.data) : null;
  const underused = summary?.rows.filter((r) => r.verdict === "underused").length ?? 0;

  return (
    <Card>
      <Stack gap={3}>
        <Row align="center" gap={2} wrap>
          <strong>GPU utilisation</strong>
          {underused > 0 && <Badge tone="warn">{`${underused} underused`}</Badge>}
        </Row>
        <div className="muted small">
          How busy each pod&apos;s claimed NVIDIA GPUs were over the last 24 hours, from the DCGM exporter&apos;s metrics in
          this cluster&apos;s Prometheus (graphics-engine activity for MIG slices). A GPU counts as underused when it averages
          under {UNDERUSED_AVG}% and never passes {UNDERUSED_PEAK}% across at least {MIN_HOURS} hours of data. Sharing it
          (time-slicing, or a MIG slice on GPUs that support it) could free the rest for other work.
        </div>
        {q.isLoading && <SkeletonLines lines={3} label="Loading GPU utilisation…" />}
        {q.error instanceof PromNotConfiguredError && (
          <div className="muted small">Set a Prometheus URL for this cluster in Settings to see how busy the claimed GPUs are.</div>
        )}
        {q.error && !(q.error instanceof PromNotConfiguredError) && (
          <InlineBanner tone="warn" flush>
            {q.error instanceof Error ? q.error.message : String(q.error)}
          </InlineBanner>
        )}
        {summary && !summary.dcgmFound && (
          <div className="muted small">
            No DCGM exporter metrics in this cluster&apos;s Prometheus. GPU utilisation needs NVIDIA&apos;s dcgm-exporter (part of
            the GPU Operator) scraped by it.
          </div>
        )}
        {summary && summary.dcgmFound && (
          <DataTable
            rows={summary.rows}
            rowKey={(r) => `${r.namespace}/${r.pod}`}
            empty={<div className="muted small">No running pod claims an NVIDIA GPU.</div>}
            columns={[
              { key: "ns", header: "Namespace", render: (r: GpuUtilRow) => <NsPill>{r.namespace}</NsPill> },
              { key: "pod", header: "Pod", className: "mono small", render: (r: GpuUtilRow) => r.pod },
              { key: "gpus", header: "GPUs", className: "mono small", render: (r: GpuUtilRow) => `${r.gpus} × ${r.resource}` },
              { key: "avg", header: "Average", className: "mono small", render: (r: GpuUtilRow) => pct(r.avgUtil) },
              { key: "peak", header: "Peak", className: "mono small", render: (r: GpuUtilRow) => pct(r.peakUtil) },
              {
                key: "mem",
                header: "Peak memory",
                className: "mono small",
                render: (r: GpuUtilRow) => (r.fbPeakMiB !== null && r.fbTotalMiB !== null ? `${gib(r.fbPeakMiB)} / ${gib(r.fbTotalMiB)} GiB` : "—"),
              },
              { key: "observed", header: "Observed", className: "mono small", render: (r: GpuUtilRow) => (r.verdict === "no-data" ? "—" : `${r.hoursObserved}h`) },
              { key: "verdict", header: "", render: (r: GpuUtilRow) => <Badge tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Badge> },
            ]}
          />
        )}
      </Stack>
    </Card>
  );
}
