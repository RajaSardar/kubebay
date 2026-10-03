import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, chartColor, EmptyState, InlineBanner, Row, SkeletonLines } from "@kubebay/ui";
import { LineChart } from "./LineChart";
import ConfigurePrometheusModal from "./ConfigurePrometheusModal";
import { promApi } from "../lib/api";

const RANGES = [
  { label: "15m", ms: 900_000, step: 30 },
  { label: "1h", ms: 3_600_000, step: 60 },
  { label: "6h", ms: 21_600_000, step: 300 },
  { label: "24h", ms: 86_400_000, step: 900 },
];

const MAX_RETRIES = 3;
const RETRY_INTERVAL = 15_000;

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [command]);
  return (
    <div style={{ position: "relative", margin: "8px 0 0" }}>
      <pre
        className="mono"
        style={{
          fontSize: "var(--kb-text-xs)",
          whiteSpace: "pre-wrap",
          background: "var(--kb-bg-inset)",
          padding: "8px 40px 8px 8px",
          borderRadius: "var(--kb-radius-xs)",
          margin: 0,
          cursor: "pointer",
          userSelect: "all",
        }}
        onClick={copy}
      >
        {command}
      </pre>
      <button
        onClick={copy}
        title="Copy to clipboard"
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          background: "transparent",
          border: "1px solid var(--kb-border-subtle)",
          borderRadius: "var(--kb-radius-xs)",
          padding: "2px 6px",
          fontSize: "var(--kb-text-2xs)",
          cursor: "pointer",
          color: "var(--kb-fg-muted)",
        }}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

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
  const promUrl = settings.data?.prometheusUrls?.[cluster] ?? settings.data?.prometheusUrl ?? "";
  const [rangeIdx, setRangeIdx] = useState(1);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const range = RANGES[rangeIdx]!;

  const to = Date.now();
  const from = to - range.ms;

  const cpuQ = `sum(rate(container_cpu_usage_seconds_total{namespace="${namespace}",pod="${pod}",container!="",image!=""}[5m])) by (container)`;
  const memQ = `sum(container_memory_working_set_bytes{namespace="${namespace}",pod="${pod}",container!="",image!=""}) by (container)`;

  const enabled = !!promUrl && !!cluster;
  const queryClient = useQueryClient();

  const cpu = useQuery({
    queryKey: ["prom-cpu", cluster, cpuQ, rangeIdx],
    queryFn: () => promApi.queryRange({ cluster, query: cpuQ, startMs: from, endMs: to, stepSec: range.step }),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
  const mem = useQuery({
    queryKey: ["prom-mem", cluster, memQ, rangeIdx],
    queryFn: () => promApi.queryRange({ cluster, query: memQ, startMs: from, endMs: to, stepSec: range.step }),
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
      label: r.metric.container || "container",
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

  if (settings.isLoading) return <SkeletonLines lines={5} label="Loading graphs…" />;

  if (!promUrl)
    return (
      <>
        <EmptyState style={{ margin: "var(--kb-gutter)" }}>
          <p>History graphs need Prometheus.</p>
          <p className="muted small">Set the server URL in Settings &rarr; Prometheus.</p>
          <Button variant="ghost" onClick={() => setShowConfigModal(true)}>
            Configure Prometheus
          </Button>
        </EmptyState>
        {showConfigModal && (
          <ConfigurePrometheusModal
            cluster={cluster}
            onClose={() => setShowConfigModal(false)}
            onSaved={() => {
              setShowConfigModal(false);
              setRetryCount(0);
              queryClient.invalidateQueries({ queryKey: ["settings"] });
              queryClient.invalidateQueries({ queryKey: ["prom-cpu", cluster] });
              queryClient.invalidateQueries({ queryKey: ["prom-mem", cluster] });
            }}
          />
        )}
      </>
    );

  const pfCommand = "kubectl -n monitoring port-forward svc/<prometheus-server> 19090:80";

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
      </div>

      {isUnreachable && (
        <>
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
          {showConfigModal && (
            <ConfigurePrometheusModal
              cluster={cluster}
              onClose={() => setShowConfigModal(false)}
              onSaved={() => {
                setShowConfigModal(false);
                setRetryCount(0);
                queryClient.invalidateQueries({ queryKey: ["settings"] });
                queryClient.invalidateQueries({ queryKey: ["prom-cpu", cluster] });
                queryClient.invalidateQueries({ queryKey: ["prom-mem", cluster] });
              }}
            />
          )}
        </>
      )}

      {anyErr && !isUnreachable && (
        <InlineBanner flush>Prometheus query failed -- check URL/reachability in Settings.</InlineBanner>
      )}

      {!anyErr && (
        <>
          <p className="subtle small" style={{ margin: "4px 0 6px" }}>CPU usage per container</p>
          <LineChart series={cpuSeries} fromMs={from} toMs={to} format={fmtCpuV} />
          <p className="subtle small" style={{ margin: "14px 0 6px" }}>Memory working set per container</p>
          <LineChart series={memSeries} fromMs={from} toMs={to} format={fmtMemB} />
        </>
      )}

      {showConfigModal && !isUnreachable && (
        <ConfigurePrometheusModal
          cluster={cluster}
          onClose={() => setShowConfigModal(false)}
          onSaved={() => {
            setShowConfigModal(false);
            setRetryCount(0);
            queryClient.invalidateQueries({ queryKey: ["settings"] });
            queryClient.invalidateQueries({ queryKey: ["prom-cpu", cluster] });
            queryClient.invalidateQueries({ queryKey: ["prom-mem", cluster] });
          }}
        />
      )}
    </div>
  );
}
