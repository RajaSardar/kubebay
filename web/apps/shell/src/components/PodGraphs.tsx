import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@kubebay/ui";
import { LineChart } from "./LineChart";
import { promApi } from "../lib/api";

const RANGES = [
  { label: "15m", ms: 900_000, step: 30 },
  { label: "1h", ms: 3_600_000, step: 60 },
  { label: "6h", ms: 21_600_000, step: 300 },
  { label: "24h", ms: 86_400_000, step: 900 },
];

export function PodGraphs({
  cluster,
  namespace,
  pod,
}: {
  cluster: string;
  namespace: string;
  pod: string;
}) {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => import("../lib/api").then((m) => m.settingsApi.get()),
    staleTime: 30_000,
  });
  const promUrl = settings.data?.prometheusUrl ?? "";
  const [rangeIdx, setRangeIdx] = useState(1);
  const range = RANGES[rangeIdx]!;

  const to = Date.now();
  const from = to - range.ms;

  const cpuQ = `sum(rate(container_cpu_usage_seconds_total{namespace="${namespace}",pod="${pod}",container!="",image!=""}[5m])) by (container)`;
  const memQ = `sum(container_memory_working_set_bytes{namespace="${namespace}",pod="${pod}",container!="",image!=""}) by (container)`;

  const enabled = !!promUrl && !!cluster;

  const cpu = useQuery({
    queryKey: ["prom-cpu", cluster, cpuQ, rangeIdx],
    queryFn: () => promApi.queryRange({ query: cpuQ, startMs: from, endMs: to, stepSec: range.step }),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
  const mem = useQuery({
    queryKey: ["prom-mem", cluster, memQ, rangeIdx],
    queryFn: () => promApi.queryRange({ query: memQ, startMs: from, endMs: to, stepSec: range.step }),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });

  const palette = ["#5b8def", "#41c98e", "#dca154", "#c586e8", "#4fc4cf"];

  function toSeries(
    res: { data: { result: { metric: Record<string, string>; values: [number, string][] }[] } } | undefined,
    colorSeed: number,
    scale: (v: number) => number,
  ) {
    return (res?.data.result ?? []).map((r, i) => ({
      label: r.metric.container || "container",
      color: palette[(i + colorSeed) % palette.length] ?? "#5b8def",
      points: r.values.map(([ts, v]) => [ts * 1000, scale(Number(v))] as [number, number]),
    }));
  }

  const fmtCpuV = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} core` : `${Math.round(v)}m`);
  const fmtMemB = (v: number) => {
    if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)}Gi`;
    if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(0)}Mi`;
    return `${(v / 1024).toFixed(0)}Ki`;
  };

  const cpuSeries = useMemo(() => toSeries(cpu.data, 0, (v) => v * 1000), [cpu.data]);
  const memSeries = useMemo(() => toSeries(mem.data, 2, (v) => v), [mem.data]);

  if (settings.isLoading) return <div className="muted small" style={{ padding: 14 }}>Loading…</div>;

  if (!promUrl)
    return (
      <div className="empty-state" style={{ margin: 14 }}>
        <p>History graphs need Prometheus.</p>
        <p className="muted small">Set the server URL in Settings → Prometheus.</p>
      </div>
    );

  const anyErr = cpu.isError || mem.isError;

  return (
    <div style={{ padding: 12, overflowY: "auto", height: "100%" }}>
      <div className="toolbar">
        {RANGES.map((r, i) => (
          <Button
            key={r.label}
            variant={i === rangeIdx ? "primary" : "ghost"}
            onClick={() => setRangeIdx(i)}
          >
            {r.label}
          </Button>
        ))}
        {(cpu.isFetching || mem.isFetching) && <span className="muted small">loading…</span>}
      </div>

      {anyErr && (
        <div className="error-banner">Prometheus query failed — check URL/reachability in Settings.</div>
      )}

      {!anyErr && (
        <>
          <p className="subtle small" style={{ margin: "4px 0 6px" }}>CPU usage per container</p>
          <LineChart series={cpuSeries} fromMs={from} toMs={to} format={fmtCpuV} />
          <p className="subtle small" style={{ margin: "14px 0 6px" }}>Memory working set per container</p>
          <LineChart series={memSeries} fromMs={from} toMs={to} format={fmtMemB} />
        </>
      )}
    </div>
  );
}
