import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import { Badge, Button, Skeleton, StatusDot } from "@kubebay/ui";
import { api, helmApi, type HelmRelease } from "../lib/api";

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

function TwoStep({ label, busy, onGo }: { label: string; busy?: boolean; onGo: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      variant={armed ? "danger" : "ghost"}
      disabled={busy}
      onClick={() => (armed ? onGo() : setArmed(true))}
    >
      {armed ? "Confirm?" : label}
    </Button>
  );
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
      await qc.invalidateQueries({ queryKey: ["helm-history"] });
      await qc.invalidateQueries({ queryKey: ["helm-releases"] });
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
              <Button variant="ghost" className="kb-btn-danger-ghost" onClick={() => setConfirmingDelete(true)}>
                Uninstall
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </>
          ) : (
            <>
              <Badge tone="err">type "{rel.name}"</Badge>
              <input
                className="toolbar-input"
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
        <div className="error-banner" style={{ margin: "10px 14px 0" }}>
          {err}
        </div>
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
                    <TwoStep label="Rollback" busy={busy} onGo={() => void rollback(h.revision)} />
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
            <input
              className="toolbar-input"
              placeholder="chart ref — repo/name or .tgz URL"
              value={chartRef}
              onChange={(e) => setChartRef(e.target.value)}
              spellCheck={false}
              style={{ flex: 2 }}
            />
            <input
              className="toolbar-input"
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
                theme="vs-dark"
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
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const list = clusters.data ?? [];
  const effectiveCluster = list.find((c) => c.status === "connected")?.id || list[0]?.id || "";

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
      <div className="page-header">
        <h2>
          Helm releases{" "}
          {!releases.isLoading && (
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              · {rows.length}
            </span>
          )}
        </h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select className="toolbar-select" value={effectiveCluster} onChange={() => undefined} aria-label="cluster">
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {releases.isError && (
        <div className="error-banner">Failed to list releases — is the cluster reachable?</div>
      )}

      {!effectiveCluster ? (
        <p className="muted">Waiting for cluster…</p>
      ) : releases.isLoading ? (
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr>{["Name", "Namespace", "Chart", "Status", "Revision", "Updated"].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[0, 1, 2].map((i) => (
                <tr key={i}>
                  {[140, 90, 150, 80, 50, 90].map((w, j) => (
                    <td key={j}>
                      <Skeleton w={w} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>No Helm releases in this cluster.</p>
          <p className="muted small">Install one with your local helm CLI — it appears here within seconds.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Namespace</th>
                <th>Chart</th>
                <th>Status</th>
                <th>Rev</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tone = statusTone(r.status);
                return (
                  <tr key={`${r.namespace}/${r.name}`} className="row-clickable" onClick={() => pick(r)}>
                    <td className="mono strong">{r.name}</td>
                    <td className="mono muted">{r.namespace}</td>
                    <td className="mono muted">
                      {r.chart}
                      {r.appVersion ? ` (${r.appVersion})` : ""}
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <StatusDot status={tone.dot} />
                        <Badge tone={tone.badge}>{r.status.toLowerCase()}</Badge>
                      </span>
                    </td>
                    <td className="mono muted">{r.revision}</td>
                    <td className="mono muted">{fmtUpdated(r.updated)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && <ReleaseDrawer cluster={effectiveCluster} rel={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
