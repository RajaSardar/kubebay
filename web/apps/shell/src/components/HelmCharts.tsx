import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import { Badge, Button, Card, Skeleton } from "@kubebay/ui";
import { api, helmApi, helmMarketApi, type HelmChartEntry } from "../lib/api";

function InstallPanel({
  cluster,
  repoName,
  chart,
  onClose,
  onInstalled,
}: {
  cluster: string;
  repoName: string;
  chart: HelmChartEntry;
  onClose: () => void;
  onInstalled: (releaseName: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(chart.name.replace(/[^a-z0-9-]/g, "-"));
  const [ns, setNs] = useState("default");
  const [version, setVersion] = useState("");
  const [values, setValues] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const defaultsQ = useQuery({
    queryKey: ["chart-defaults", cluster, chart.name, version],
    queryFn: () => helmMarketApi.chartValuesText(cluster, `${repoName}/${chart.name}`, version || undefined),
    retry: false,
  });

  const valuesYaml = values ?? defaultsQ.data ?? "# loading default values…\n";

  async function install() {
    setErr("");
    if (!name) {
      setErr("Release name required.");
      return;
    }
    setBusy(true);
    try {
      await helmApi.upgrade({
        cluster,
        ns,
        name,
        chartRef: `${repoName}/${chart.name}`,
        version: version || undefined,
        valuesYaml: valuesYaml,
      });
      await qc.invalidateQueries({ queryKey: ["helm-releases"] });
      onInstalled(name);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <div style={{ minWidth: 0 }}>
          <div className="mono strong">{chart.name}</div>
          <div className="muted small">{chart.description?.slice(0, 90)}</div>
        </div>
        <div className="drawer-head-actions">
          <Badge>v{chart.version}</Badge>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {err && (
        <div className="error-banner" style={{ margin: "10px 14px 0" }}>
          {err}
        </div>
      )}

      <div className="log-controls">
        <input
          className="toolbar-input"
          placeholder="release name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          spellCheck={false}
          style={{ maxWidth: 160 }}
        />
        <input
          className="toolbar-input"
          placeholder="namespace"
          value={ns}
          onChange={(e) => setNs(e.target.value)}
          spellCheck={false}
          style={{ maxWidth: 130 }}
        />
        <input
          className="toolbar-input"
          placeholder={`version (${chart.version})`}
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          spellCheck={false}
          style={{ maxWidth: 140 }}
        />
        <div style={{ marginLeft: "auto" }} />
        <Button disabled={busy} onClick={() => void install()}>
          {busy ? "Installing…" : "Install"}
        </Button>
      </div>

      <div className="yaml-editor" style={{ height: "calc(100vh - 300px)" }}>
        {defaultsQ.isLoading ? (
          <Skeleton w={400} h={200} />
        ) : (
          <Editor
            value={valuesYaml}
            onChange={(v) => setValues(v ?? "")}
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
    </aside>
  );
}

export function ChartsTab({ cluster }: { cluster: string }) {
  const qc = useQueryClient();
  const repos = useQuery({
    queryKey: ["helm-repos", cluster],
    queryFn: () => helmMarketApi.repos(cluster),
    retry: false,
  });
  const [repoSel, setRepoSel] = useState("");
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState("");
  const [installing, setInstalling] = useState<HelmChartEntry | null>(null);

  const repoList = repos.data ?? [];
  const effectiveRepo = repoSel || repoList[0]?.name || "";

  const charts = useQuery({
    queryKey: ["helm-charts", cluster, effectiveRepo],
    queryFn: () => helmMarketApi.charts(cluster, effectiveRepo),
    enabled: !!effectiveRepo,
    staleTime: 60_000,
    retry: false,
  });

  const filtered = useMemo(() => {
    const out = [...(charts.data ?? [])];
    if (search) {
      const q = search.toLowerCase();
      return out.filter((c) => c.name.includes(q) || c.description.toLowerCase().includes(q));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [charts.data, search]);

  async function updateIndexes() {
    setUpdating(true);
    setUpdateMsg("");
    try {
      const res = await helmMarketApi.updateRepos(cluster);
      const bad = Object.entries(res).filter(([, v]) => v !== "ok");
      setUpdateMsg(bad.length ? `Updated with errors: ${bad.map(([k]) => k).join(", ")}` : "All repo indexes updated.");
      await qc.invalidateQueries({ queryKey: ["helm-charts"] });
    } catch (e) {
      setUpdateMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setUpdating(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <select
          className="toolbar-select"
          value={effectiveRepo}
          onChange={(e) => setRepoSel(e.target.value)}
          aria-label="repository"
        >
          {repoList.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name}
            </option>
          ))}
          {!repoList.length && <option value="">no repositories</option>}
        </select>
        <input
          className="toolbar-input"
          placeholder="Search charts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
        <Button variant="ghost" disabled={updating || !repoList.length} onClick={() => void updateIndexes()}>
          {updating ? "Updating…" : "Update indexes"}
        </Button>
        <Badge>{filtered.length}</Badge>
      </div>

      {updateMsg && (
        <p className="muted small" style={{ marginTop: -6, marginBottom: 10 }}>
          {updateMsg}
        </p>
      )}

      {!repoList.length && (
        <div className="empty-state">
          <p>No Helm repositories configured.</p>
          <p className="muted small">Kubebay reads your local helm config — run “helm repo add …” once.</p>
        </div>
      )}

      {charts.isError && (
        <div className="error-banner">Failed to load index — press “Update indexes”.</div>
      )}

      <div className="cluster-grid">
        {charts.isLoading &&
          [0, 1, 2].map((i) => (
            <Card key={i}>
              <Skeleton w={140} h={14} />
              <div style={{ marginTop: 8 }}>
                <Skeleton w={220} h={10} />
              </div>
            </Card>
          ))}
        {!charts.isLoading &&
          filtered.map((c) => (
            <Card key={c.name} interactive className="fleet-card">
              <div style={{ cursor: "pointer" }} onClick={() => setInstalling(c)}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>{c.name}</strong>
                  <Badge>v{c.version}</Badge>
                  {c.versions > 1 && <span className="muted small mono">{c.versions} versions</span>}
                </div>
                <p className="muted small" style={{ margin: "6px 0 0", minHeight: 30 }}>
                  {c.description || "—"}
                </p>
                {c.appVersion && <div className="muted small mono">app {c.appVersion}</div>}
              </div>
            </Card>
          ))}
      </div>

      {installing && (
        <InstallPanel
          cluster={cluster}
          repoName={effectiveRepo}
          chart={installing}
          onClose={() => setInstalling(null)}
          onInstalled={() => {
            setInstalling(null);
          }}
        />
      )}
    </>
  );
}

export function useHelmReleasesSafe() {
  return api;
}
