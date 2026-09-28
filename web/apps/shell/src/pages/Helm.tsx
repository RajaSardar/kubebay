import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import { ArmedButton, Badge, Button, DataTable, EmptyState, InlineBanner, PageHeader, Skeleton, StatusDot, TextField } from "@kubebay/ui";
import { helmApi, type HelmRelease } from "../lib/api";
import { useCluster } from "../lib/useCluster";
import { useMonacoTheme } from "../lib/theme";
import { ChartsTab } from "../components/HelmCharts";

type DotT = "connected" | "degraded" | "unreachable" | "pending";
interface Tone {
  dot: DotT;
  badge?: "ok" | "err";
}

const STATUS_TONE: Record<string, Tone> = {
  deployed: { dot: "connected", badge: "ok" },
  failed: { dot: "unreachable", badge: "err" },
  "pending-install": { dot: "pending" },
  "pending-upgrade": { dot: "pending" },
  uninstalling: { dot: "degraded" },
};

function statusTone(s: string) {
  return STATUS_TONE[s.toLowerCase()] ?? { dot: "pending" as const };
}

function fmtUpdated(iso?: string): string {
  if (!iso) return "–";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ReleaseDrawer({
  cluster,
  rel,
  onClose,
}: {
  cluster: string;
  rel: HelmRelease;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const monacoTheme = useMonacoTheme();
  const [tab, setTab] = useState<"history" | "values" | "manifest">("history");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const history = useQuery({
    queryKey: ["helm-history", cluster, rel.namespace, rel.name],
    queryFn: () => helmApi.history(cluster, rel.namespace, rel.name),
  });
  const valuesQ = useQuery({
    queryKey: ["helm-values", cluster, rel.namespace, rel.name],
    queryFn: () => helmApi.valuesText(cluster, rel.namespace, rel.name),
    enabled: tab === "values",
  });
  const manifestQ = useQuery({
    queryKey: ["helm-manifest", cluster, rel.namespace, rel.name],
    queryFn: () => helmApi.manifestText(cluster, rel.namespace, rel.name),
    enabled: tab === "manifest",
  });

  const [valuesEdited, setValuesEdited] = useState<string | null>(null);
  const valuesYaml = valuesEdited ?? valuesQ.data ?? "";
  const valuesDirty = valuesEdited !== null && valuesEdited !== valuesQ.data;

  const [chartRef, setChartRef] = useState(rel.chart ? `${rel.chart}` : "");
  const [chartVersion, setChartVersion] = useState("");

  async function apply() {
    setErr("");
    setBusy(true);
    try {
      await helmApi.upgrade({
        cluster,
        ns: rel.namespace,
        name: rel.name,
        chartRef,
        version: chartVersion || undefined,
        valuesYaml: valuesYaml,
      });
      setValuesEdited(null);
      await qc.invalidateQueries({ queryKey: ["helm-releases"] });
      await qc.invalidateQueries({ queryKey: ["helm-history"] });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function rollback(revision: number) {
    setErr("");
    setBusy(true);
    try {
      await helmApi.rollback({ cluster, ns: rel.namespace, name: rel.name, revision });
      setValuesEdited(null);
      await qc.invalidateQueries({ queryKey: ["helm-history"] });
      await qc.invalidateQueries({ queryKey: ["helm-releases"] });
      await qc.invalidateQueries({ queryKey: ["helm-values", cluster, rel.namespace, rel.name] });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function uninstall() {
    setBusy(true);
    try {
      await helmApi.uninstall({ cluster, ns: rel.namespace, name: rel.name });
      onClose();
      await qc.invalidateQueries({ queryKey: ["helm-releases"] });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  const tone = statusTone(rel.status);

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <StatusDot status={tone.dot} />
        <div style={{ minWidth: 0 }}>
          <div className="mono strong">{rel.name}</div>
          <div className="muted small mono">{rel.namespace}</div>
        </div>
        <div className="drawer-head-actions">
          {!confirmingDelete ? (
            <>
              <Button variant="danger-ghost" onClick={() => setConfirmingDelete(true)}>
                Uninstall
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </>
          ) : (
            <>
              <Badge tone="err">type "{rel.name}"</Badge>
              <TextField
                style={{ maxWidth: 170 }}
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                spellCheck={false}
              />
              <Button variant="danger" disabled={busy || deleteInput !== rel.name} onClick={() => void uninstall()}>
                Confirm
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {err && (
        <InlineBanner flush style={{ margin: "10px 14px 0" }}>
          {err}
        </InlineBanner>
      )}

      <div className="tabs">
        {(["history", "values", "manifest"] as const).map((t) => (
          <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t[0]?.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "history" && (
        <div className="log-view" style={{ background: "var(--kb-bg-surface)" }}>
          {(history.data ?? []).map((h) => (
            <div key={h.revision} className="tl-item" style={{ padding: "8px 4px" }}>
              <StatusDot status={statusTone(h.status).dot} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="mono strong">rev {h.revision}</span>
                  <Badge tone={statusTone(h.status).badge}>{h.status.toLowerCase()}</Badge>
                  <span className="mono muted small">{h.chartVersion && `chart ${h.chartVersion}`}</span>
                  <span className="muted small" style={{ marginLeft: "auto" }}>{fmtUpdated(h.updated)}</span>
                  {h.revision !== rel.revision && (
                    <ArmedButton
                      label="Rollback"
                      confirmLabel="Confirm?"
                      busy={busy}
                      armMs={3000}
                      onGo={() => void rollback(h.revision)}
                    />
                  )}
                </div>
                {h.description && <div className="muted small">{h.description}</div>}
              </div>
            </div>
          ))}
          {!history.data && <p className="muted small">Loading history…</p>}
        </div>
      )}

      {tab === "values" && (
        <>
          <div className="log-controls">
            <TextField
              placeholder="chart ref — repo/name or .tgz URL"
              value={chartRef}
              onChange={(e) => setChartRef(e.target.value)}
              spellCheck={false}
              style={{ flex: 2 }}
            />
            <TextField
              placeholder="version (latest)"
              value={chartVersion}
              onChange={(e) => setChartVersion(e.target.value)}
              spellCheck={false}
              style={{ maxWidth: 130 }}
            />
            {valuesDirty && <Badge>modified</Badge>}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <Button variant="ghost" onClick={() => setValuesEdited(null)} disabled={!valuesDirty}>
                Discard
              </Button>
              <Button disabled={busy || !valuesDirty} onClick={() => void apply()}>
                Save &amp; upgrade
              </Button>
            </div>
          </div>
          <div className="yaml-editor" style={{ height: "calc(100vh - 300px)" }}>
            {valuesQ.isLoading ? (
              <Skeleton w={400} h={200} />
            ) : (
              <Editor
                value={valuesYaml}
                onChange={(v) => setValuesEdited(v ?? "")}
                defaultLanguage="yaml"
                theme={monacoTheme}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            )}
          </div>
        </>
      )}

      {tab === "manifest" && (
        <pre className="log-view mono" style={{ whiteSpace: "pre-wrap", userSelect: "text" }}>
          {manifestQ.isLoading ? "Loading…" : manifestQ.data}
        </pre>
      )}
    </aside>
  );
}

export default function Helm() {
  const [view, setView] = useState<"releases" | "charts">("releases");
  const { cluster: effectiveCluster } = useCluster();

  const releases = useQuery({
    queryKey: ["helm-releases", effectiveCluster],
    queryFn: () => helmApi.releases(effectiveCluster),
    enabled: !!effectiveCluster,
    refetchInterval: 12_000,
    retry: false,
  });

  const rows = useMemo(() => {
    const out = [...(releases.data ?? [])];
    out.sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
    return out;
  }, [releases.data]);

  const [selected, setSelected] = useState<HelmRelease | null>(null);

  useEffect(() => {
    setSelected(null);
  }, [effectiveCluster]);

  function pick(r: HelmRelease) {
    setSelected(r);
  }

  return (
    <div className="page">
      <div className="tabs" style={{ padding: 0, marginBottom: 14 }}>
        {(["releases", "charts"] as const).map((t) => (
          <button key={t} className={`tab${view === t ? " active" : ""}`} onClick={() => setView(t)}>
            {t === "releases" ? "Releases" : "Charts — install"}
          </button>
        ))}
      </div>

      {view === "charts" && (
        <ChartsTab cluster={effectiveCluster} />
      )}

      {view === "releases" && (
      <>
      <PageHeader level={2} title="Helm releases" count={!releases.isLoading && `· ${rows.length}`} />

      {releases.isError && (
        <InlineBanner flush>
          Failed to list releases —{" "}
          {releases.error instanceof Error ? releases.error.message : "is the cluster reachable?"}
          <Button variant="ghost" onClick={() => void releases.refetch()}>Retry</Button>
        </InlineBanner>
      )}

      {!effectiveCluster ? (
        <div className="loading-state">
          <p>Waiting for cluster…</p>
        </div>
      ) : (
        <DataTable
          loading={releases.isLoading}
          rows={rows}
          rowKey={(r) => `${r.namespace}/${r.name}`}
          onRowClick={pick}
          empty={
            <EmptyState
              title="No Helm releases in this cluster."
              hint="Install one with your local helm CLI — it appears here within seconds."
            />
          }
          columns={[
            { key: "name", header: "Name", className: "mono strong", render: (r) => r.name },
            { key: "ns", header: "Namespace", className: "mono muted", render: (r) => r.namespace },
            {
              key: "chart",
              header: "Chart",
              className: "mono muted",
              render: (r) => `${r.chart}${r.appVersion ? ` (${r.appVersion})` : ""}`,
            },
            {
              key: "status",
              header: "Status",
              render: (r) => {
                const tone = statusTone(r.status);
                return (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <StatusDot status={tone.dot} />
                    <Badge tone={tone.badge}>{r.status.toLowerCase()}</Badge>
                  </span>
                );
              },
            },
            { key: "rev", header: "Rev", className: "mono muted", render: (r) => r.revision },
            { key: "updated", header: "Updated", className: "mono muted", render: (r) => fmtUpdated(r.updated) },
          ]}
        />
      )}

      {selected && <ReleaseDrawer cluster={effectiveCluster} rel={selected} onClose={() => setSelected(null)} />}
      </>
      )}
    </div>
  );
}

