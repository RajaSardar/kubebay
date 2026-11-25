import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, chartColor, EmptyState, InlineBanner, Row, SkeletonLines } from "@kubebay/ui";
import { LineChart } from "./LineChart";
import ConfigurePrometheusModal from "./ConfigurePrometheusModal";
import { promApi } from "../lib/api";
import { podCpuQueries, podMemQueries, firstWithSeries } from "../lib/podPromQueries";
import { CopyableCommand } from "./CopyableCommand";
import { PromNotFound, PromTestPanel } from "./PromDiagnostics";

const RANGES = [
  { label: "15m", ms: 900_000, step: 30 },
  { label: "1h", ms: 3_600_000, step: 60 },
  { label: "6h", ms: 21_600_000, step: 300 },
  { label: "24h", ms: 86_400_000, step: 900 },
];

const MAX_RETRIES = 3;
const RETRY_INTERVAL = 15_000;

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
  // A URL set for this cluster always wins. Otherwise the engine says what it uses: a Service
  // detected in the cluster, or the Settings default URL when none is found.
  const ownUrl = settings.data?.prometheusUrls?.[cluster] ?? "";
  const status = useQuery({
    queryKey: ["prom-status", cluster],
    queryFn: async () => (await promApi.status(cluster)) ?? { source: "none" as const, target: "", chosen: false, candidates: [] },
    enabled: !!cluster && !ownUrl && !settings.isLoading,
    staleTime: 60_000,
  });
  const source = ownUrl ? "manual" : (status.data?.source ?? "none");
  const autoTarget = !ownUrl && status.data?.source === "auto" ? status.data.target : "";
  const defaultUrl = !ownUrl && status.data?.source === "default" ? status.data.target : "";
  const [rangeIdx, setRangeIdx] = useState(1);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const range = RANGES[rangeIdx]!;

  const to = Date.now();
  const from = to - range.ms;

  const cpuQs = podCpuQueries(namespace, pod);
  const memQs = podMemQueries(namespace, pod);

  const enabled = source !== "none" && !!cluster;
  const queryClient = useQueryClient();

  const run = (query: string) => promApi.queryRange({ cluster, query, startMs: from, endMs: to, stepSec: range.step });
  const cpu = useQuery({
    queryKey: ["prom-cpu", cluster, namespace, pod, rangeIdx],
    queryFn: () => firstWithSeries(cpuQs, run),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
  const mem = useQuery({
    queryKey: ["prom-mem", cluster, namespace, pod, rangeIdx],
    queryFn: () => firstWithSeries(memQs, run),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });

  // Auto-retry logic for unreachable prometheus
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();

  const anyErr = cpu.isError || mem.isError;
  const errBody = cpu.error ?? mem.error;
  const cause = errBody instanceof Error ? (errBody as { cause?: { hint?: string } }).cause : undefined;
  const isUnreachable =
    (errBody instanceof Error && errBody.message.includes("prometheus-unreachable")) ||
    !!cause?.hint;

  useEffect(() => {
    if (!anyErr || !isUnreachable) {
      // Reset retry state on success or non-unreachable error
      setRetryCount(0);
      setRetrying(false);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      return;
    }
    if (retryCount >= MAX_RETRIES) {
      setRetrying(false);
      return;
    }
    setRetrying(true);
    retryTimer.current = setTimeout(() => {
      setRetryCount((c) => c + 1);
      queryClient.invalidateQueries({ queryKey: ["prom-cpu"] });
      queryClient.invalidateQueries({ queryKey: ["prom-mem"] });
    }, RETRY_INTERVAL);
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [anyErr, isUnreachable, retryCount, queryClient]);

  function toSeries(
    res: { data: { result: { metric: Record<string, string>; values: [number, string][] }[] } } | undefined,
    colorSeed: number,
    scale: (v: number) => number,
  ) {
    return (res?.data.result ?? []).map((r, i) => ({
      label: r.metric.container || r.metric.pod || "container",
      color: chartColor(i + colorSeed),
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

  if (settings.isLoading || (!ownUrl && status.isLoading)) return <SkeletonLines lines={5} label="Loading graphs…" />;

  const onSaved = () => {
    setShowConfigModal(false);
    setRetryCount(0);
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    queryClient.invalidateQueries({ queryKey: ["prom-status", cluster] });
    queryClient.invalidateQueries({ queryKey: ["prom-cpu", cluster] });
    queryClient.invalidateQueries({ queryKey: ["prom-mem", cluster] });
  };
  const modal = showConfigModal && (
    <ConfigurePrometheusModal cluster={cluster} onClose={() => setShowConfigModal(false)} onSaved={onSaved} />
  );

  if (source === "none")
    return (
      <>
        <EmptyState style={{ margin: "var(--kb-gutter)" }}>
          <p>History graphs need Prometheus.</p>
          <PromNotFound
            cluster={cluster}
            status={status.data}
            locked={!!settings.data?.sharedLocked}
            onChoose={() => setShowConfigModal(true)}
            onEnterUrl={() => setShowConfigModal(true)}
          />
        </EmptyState>
        {modal}
      </>
    );

  const pfCommand = "kubectl -n monitoring port-forward svc/<prometheus-server> 19090:80";
  const loaded = !!cpu.data && !!mem.data;
  const noSeries = loaded && !anyErr && cpuSeries.length === 0 && memSeries.length === 0;

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
        {(cpu.isFetching || mem.isFetching) && <span className="muted small">loading...</span>}
        {(autoTarget || defaultUrl) && (
          <span className="muted small" style={{ marginLeft: "auto" }}>
            {autoTarget ? `Auto-detected: ${autoTarget}` : `Default URL: ${defaultUrl}`}{" "}
            <Button variant="ghost" onClick={() => setShowConfigModal(true)}>
              Change
            </Button>
          </span>
        )}
      </div>

      {isUnreachable && (
        <InlineBanner flush>
          Prometheus is not reachable. Start a port-forward with:
          <CopyableCommand command={pfCommand} />
          <Row gap={2} style={{ marginTop: "8px", alignItems: "center" }}>
            <Button variant="ghost" onClick={() => setShowConfigModal(true)}>
              Configure
            </Button>
            {retrying && retryCount < MAX_RETRIES && (
              <p className="muted small" style={{ margin: 0 }}>
                Retrying automatically... ({retryCount + 1}/{MAX_RETRIES})
              </p>
            )}
            {retryCount >= MAX_RETRIES && (
              <p className="muted small" style={{ margin: 0 }}>
                Auto-retry exhausted ({MAX_RETRIES} attempts).{" "}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setRetryCount(0);
                    queryClient.invalidateQueries({ queryKey: ["prom-cpu"] });
                    queryClient.invalidateQueries({ queryKey: ["prom-mem"] });
                  }}
                  style={{
                    textDecoration: "underline",
                    padding: 0,
                  }}
                >
                  Retry again
                </Button>
              </p>
            )}
          </Row>
        </InlineBanner>
      )}

      {anyErr && !isUnreachable && (
        <InlineBanner flush>
          Prometheus query failed: {errBody instanceof Error && errBody.message ? errBody.message : "unknown error"}
        </InlineBanner>
      )}

      {(anyErr || noSeries) && (
        <>
          {noSeries && (
            <InlineBanner flush tone="warn">
              Prometheus answered, but returned no CPU or memory series for this pod. It may not scrape the kubelet&apos;s
              cAdvisor metrics, the pod may be too new for the {range.label} window, or this is not the Prometheus that
              monitors this cluster.
            </InlineBanner>
          )}
          <PromTestPanel cluster={cluster} />
        </>
      )}

      {!anyErr && !noSeries && (
        <>
          <p className="subtle small" style={{ margin: "4px 0 6px" }}>CPU usage per container</p>
          <LineChart series={cpuSeries} fromMs={from} toMs={to} format={fmtCpuV} />
          <p className="subtle small" style={{ margin: "14px 0 6px" }}>Memory working set per container</p>
          <LineChart series={memSeries} fromMs={from} toMs={to} format={fmtMemB} />
        </>
      )}

      {modal}
    </div>
  );
}
