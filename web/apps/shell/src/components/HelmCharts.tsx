import { useMemo, useState } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import { Badge, Button, Card, Skeleton } from "@kubebay/ui";
import { helmApi, helmMarketApi, type HelmChartEntry } from "../lib/api";
import { useMonacoTheme } from "../lib/theme";

const ALL_REPOS = "__all__";

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
  const monacoTheme = useMonacoTheme();
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
  const [installing, setInstalling] = useState<{ chart: HelmChartEntry; repoName: string } | null>(null);

  const repoList = repos.data ?? [];
  const isAll = repoSel === ALL_REPOS;
  const effectiveRepo = isAll ? "" : repoSel || repoList[0]?.name || "";

  // Single-repo query — disabled when "All repos" is active.
  const singleCharts = useQuery({
    queryKey: ["helm-charts", cluster, effectiveRepo],
    queryFn: () => helmMarketApi.charts(cluster, effectiveRepo),
    enabled: !isAll && !!effectiveRepo,
    staleTime: 60_000,
    retry: false,
  });

  // Parallel per-repo queries — only fired when "All repos" is selected.
  const allChartQueries = useQueries({
    queries: isAll
      ? repoList.map((r) => ({
          queryKey: ["helm-charts", cluster, r.name] as const,
          queryFn: () => helmMarketApi.charts(cluster, r.name),
          staleTime: 60_000,
          retry: false as const,
        }))
      : [],
  });

  // Flat list of {chart, repoName} tuples — populated progressively as each
  // parallel query resolves, so cards appear as soon as each repo responds.
  const allItems = useMemo(() => {
    if (!isAll) return null;
    return repoList.flatMap((r, i) => {
      const q = allChartQueries[i];
      return (q?.data ?? []).map((c) => ({ chart: c, repoName: r.name }));
    });
  }, [isAll, repoList, allChartQueries]);

  // How many repos are still loading (for ajax-style skeleton count).
  const loadingRepoCount = isAll
    ? allChartQueries.filter((q) => q.isLoading).length
    : 0;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const match = (c: HelmChartEntry) =>
      !search || c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q);

    if (isAll && allItems) {
      return allItems
        .filter(({ chart }) => match(chart))
        .sort((a, b) => a.chart.name.localeCompare(b.chart.name));
    }
    const out = (singleCharts.data ?? []).filter(match);
    if (!search) out.sort((a, b) => a.name.localeCompare(b.name));
    return out.map((chart) => ({ chart, repoName: effectiveRepo }));
  }, [isAll, allItems, singleCharts.data, search, effectiveRepo]);

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

  const isLoading = isAll ? loadingRepoCount > 0 : singleCharts.isLoading;

  // Collect per-repo errors so we can show specific messages.
  const errorMessages: string[] = useMemo(() => {
    if (isAll) {
      return repoList.flatMap((r, i) => {
        const q = allChartQueries[i];
        if (!q?.isError) return [];
        const msg = q.error instanceof Error ? q.error.message : String(q.error);
        return [`${r.name}: ${msg}`];
      });
    }
    if (singleCharts.isError) {
      const msg = singleCharts.error instanceof Error ? singleCharts.error.message : String(singleCharts.error);
      return [msg];
    }
    return [];
  }, [isAll, repoList, allChartQueries, singleCharts.isError, singleCharts.error]);

  return (
    <>
      <div className="toolbar">
        <select
          className="toolbar-select"
          value={isAll ? ALL_REPOS : effectiveRepo}
          onChange={(e) => setRepoSel(e.target.value)}
          aria-label="repository"
        >
          {repoList.length > 1 && (
            <option value={ALL_REPOS}>All repos</option>
          )}
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
        <Badge>{filtered.length}{isAll && loadingRepoCount > 0 ? "+" : ""}</Badge>
      </div>

      {updateMsg && (
        <p className="muted small" style={{ marginTop: -6, marginBottom: 10 }}>
          {updateMsg}
        </p>
      )}

      {!repoList.length && (
        <div className="empty-state">
          <p>No Helm repositories configured.</p>
          <p className="muted small">Kubebay reads your local helm config — run "helm repo add …" once.</p>
        </div>
      )}

      {errorMessages.length > 0 && (
        <div className="error-banner">
          {errorMessages.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}

      <div className="cluster-grid">
        {filtered.map(({ chart: c, repoName }) => (
          <Card key={`${repoName}/${c.name}`} interactive className="fleet-card">
            <div style={{ cursor: "pointer" }} onClick={() => setInstalling({ chart: c, repoName })}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong>{c.name}</strong>
                <Badge>v{c.version}</Badge>
                {c.versions > 1 && <span className="muted small mono">{c.versions} versions</span>}
              </div>
              <p className="muted small" style={{ margin: "6px 0 0", minHeight: 30 }}>
                {c.description || "—"}
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {c.appVersion && <span className="muted small mono">app {c.appVersion}</span>}
                {isAll && <span className="muted small mono" style={{ marginLeft: "auto" }}>{repoName}</span>}
              </div>
            </div>
          </Card>
        ))}

        {/* Ajax-style: skeleton cards for each repo still loading */}
        {isLoading &&
          Array.from({ length: isAll ? loadingRepoCount * 3 : 3 }, (_, i) => (
            <Card key={`skel-${i}`}>
              <Skeleton w={140} h={14} />
              <div style={{ marginTop: 8 }}>
                <Skeleton w={220} h={10} />
              </div>
            </Card>
          ))}
      </div>

      {installing && (
        <InstallPanel
          cluster={cluster}
          repoName={installing.repoName}
          chart={installing.chart}
          onClose={() => setInstalling(null)}
          onInstalled={() => {
            setInstalling(null);
          }}
        />
      )}
    </>
  );
}

