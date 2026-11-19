import { useMemo, useState } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import Editor, { DiffEditor } from "../lib/monaco";
import { ArmedButton, Avatar, Badge, Button, Card, Drawer, EmptyState, InlineBanner, Row, Select, Skeleton, Stack, Tabs, TextField } from "@kubebay/ui";
import { helmApi, helmMarketApi, type HelmChartDetail, type HelmChartEntry, type HelmRelease } from "../lib/api";
import { helmReleasesQuery } from "../lib/helmReleases";
import { installedAs, isWebUrl, matchesChart, releaseNameFor } from "../lib/helmStore";
import { useMonacoTheme } from "../lib/theme";
import { Markdown } from "./Markdown";

const ALL_REPOS = "__all__";

type DrawerTab = "about" | "readme" | "values" | "preview";

function ChartAbout({ detail, installed }: { detail: HelmChartDetail; installed: HelmRelease[] }) {
  // A link a chart's repo supplied is only a link when it is a web address.
  const link = (url: string) =>
    isWebUrl(url) ? (
      <a href={url} target="_blank" rel="noreferrer noopener">
        {url}
      </a>
    ) : (
      <span className="mono">{url}</span>
    );
  return (
    <Stack gap={3}>
      {detail.deprecated && <InlineBanner flush>This chart version is deprecated by its maintainers.</InlineBanner>}
      <p style={{ margin: 0 }}>{detail.description || "—"}</p>
      <p className="muted small" style={{ margin: 0 }}>
        Version {detail.version}
        {detail.appVersion ? ` · app ${detail.appVersion}` : ""} · {detail.versions.length} version
        {detail.versions.length === 1 ? "" : "s"} in {detail.repo}
      </p>
      {installed.length > 0 && (
        <div>
          <strong>Installed as</strong>
          {installed.map((r) => (
            <div key={`${r.namespace}/${r.name}`} className="small mono">
              {r.name} in {r.namespace} · chart {r.chartVersion} · {r.status}
            </div>
          ))}
        </div>
      )}
      {detail.maintainers && detail.maintainers.length > 0 && (
        <div>
          <strong>Maintainers</strong>
          {detail.maintainers.map((m, i) => (
            <div key={i} className="small">
              <span>{m.name}</span>
              {m.email && <span className="muted"> · {m.email}</span>}
              {m.url && <span className="muted"> · {m.url}</span>}
            </div>
          ))}
        </div>
      )}
      {detail.home && (
        <div>
          <strong>Home</strong>
          <div className="small">{link(detail.home)}</div>
        </div>
      )}
      {detail.sources && detail.sources.length > 0 && (
        <div>
          <strong>Sources</strong>
          {detail.sources.map((s) => (
            <div key={s} className="small">
              {link(s)}
            </div>
          ))}
        </div>
      )}
      {detail.keywords && detail.keywords.length > 0 && (
        <Row gap={2}>
          {detail.keywords.map((k) => (
            <Badge key={k}>{k}</Badge>
          ))}
        </Row>
      )}
    </Stack>
  );
}

function ChartDrawer({
  cluster,
  repoName,
  chart,
  releases,
  onClose,
}: {
  cluster: string;
  repoName: string;
  chart: HelmChartEntry;
  releases: readonly HelmRelease[] | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const monacoTheme = useMonacoTheme();
  const installed = installedAs(releases, chart.name);
  // The form starts from the release this chart already runs as, so opening an
  // installed chart upgrades that release instead of making a second copy.
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [nsEdit, setNsEdit] = useState<string | null>(null);
  const name = nameEdit ?? installed[0]?.name ?? releaseNameFor(chart.name);
  const ns = nsEdit ?? installed[0]?.namespace ?? "default";
  const [version, setVersion] = useState("");
  const [values, setValues] = useState<string | null>(null);
  const [tab, setTab] = useState<DrawerTab>("about");
  const [preview, setPreview] = useState<{ next: string; current: string | null } | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "apply">("");
  const [err, setErr] = useState("");

  const defaultsQ = useQuery({
    queryKey: ["chart-defaults", cluster, repoName, chart.name, version],
    queryFn: () => helmMarketApi.chartValuesText(cluster, `${repoName}/${chart.name}`, version || undefined),
    retry: false,
  });
  const detailQ = useQuery({
    queryKey: ["chart-detail", cluster, repoName, chart.name, version],
    queryFn: () => helmMarketApi.chart(cluster, repoName, chart.name, version || undefined),
    retry: false,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const detail = detailQ.data;

  const valuesYaml = values ?? defaultsQ.data ?? "# loading default values…\n";
  const existing = (releases ?? []).find((r) => r.name === name && r.namespace === ns);
  const verb = existing ? "Upgrade" : "Install";

  // What was previewed no longer describes the form once it changes.
  function touched() {
    setPreview(null);
    setTab((t) => (t === "preview" ? "about" : t));
    setErr("");
  }

  function request(dryRun: boolean) {
    return {
      cluster,
      ns,
      name,
      chartRef: `${repoName}/${chart.name}`,
      version: version || undefined,
      valuesYaml,
      ...(dryRun ? { dryRun: true } : {}),
    };
  }

  async function runPreview() {
    setErr("");
    if (!name) {
      setErr("Release name required.");
      return;
    }
    setBusy("preview");
    try {
      // Rendered by the engine without contacting the cluster's API server.
      const [next, current] = await Promise.all([
        helmApi.upgrade(request(true)),
        existing ? helmApi.manifestText(cluster, ns, name) : Promise.resolve(null),
      ]);
      setPreview({ next: next.manifest ?? "", current });
      setTab("preview");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy("");
    }
  }

  async function apply() {
    setErr("");
    if (!name) {
      setErr("Release name required.");
      return;
    }
    setBusy("apply");
    try {
      await helmApi.upgrade(request(false));
      await qc.invalidateQueries({ queryKey: ["helm-releases"] });
      onClose();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy("");
    }
  }

  const editorOptions = {
    minimap: { enabled: false },
    fontSize: 12,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    automaticLayout: true,
    tabSize: 2,
  } as const;

  const tabs: readonly DrawerTab[] = preview ? ["about", "readme", "values", "preview"] : ["about", "readme", "values"];

  return (
    <Drawer
      title={chart.name}
      subtitle={chart.description?.slice(0, 90)}
      subtitleMono={false}
      onClose={onClose}
      actions={
        <>
          <Badge>v{detail?.version ?? chart.version}</Badge>
          {installed.length > 0 && <Badge tone="ok">Installed</Badge>}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {err && (
        <InlineBanner flush style={{ margin: "10px 14px 0" }}>
          {err}
        </InlineBanner>
      )}
      {existing && existing.chart !== chart.name && (
        <InlineBanner flush style={{ margin: "10px 14px 0" }}>
          {existing.name} in {existing.namespace} runs the chart {existing.chart}. Applying replaces it with {chart.name}.
        </InlineBanner>
      )}

      <div className="log-controls">
        <TextField
          placeholder="release name"
          value={name}
          onChange={(e) => {
            setNameEdit(e.target.value);
            touched();
          }}
          spellCheck={false}
          style={{ maxWidth: 160 }}
        />
        <TextField
          placeholder="namespace"
          value={ns}
          onChange={(e) => {
            setNsEdit(e.target.value);
            touched();
          }}
          spellCheck={false}
          style={{ maxWidth: 130 }}
        />
        <Select
          aria-label="version"
          value={version || detail?.version || ""}
          onChange={(e) => {
            setVersion(e.target.value);
            // Another version has other default values.
            setValues(null);
            touched();
          }}
          style={{ maxWidth: 160 }}
        >
          {!detail && <option value="">latest ({chart.version})</option>}
          {(detail?.versions ?? []).map((v) => (
            <option key={v.version} value={v.version}>
              {v.version}
              {v.deprecated ? " (deprecated)" : ""}
            </option>
          ))}
        </Select>
        <div style={{ marginLeft: "auto" }} />
        <Button variant="ghost" disabled={busy !== ""} onClick={() => void runPreview()}>
          {busy === "preview" ? "Rendering…" : "Preview"}
        </Button>
        <Button disabled={busy !== ""} onClick={() => void apply()}>
          {busy === "apply" ? (existing ? "Upgrading…" : "Installing…") : verb}
        </Button>
      </div>

      <Tabs
        tabs={tabs}
        active={tab}
        labels={{ about: "About", readme: "README", values: "Values", preview: existing ? "Changes" : "Preview" }}
        onChange={setTab}
      />

      {tab === "about" && (
        <div style={{ padding: "10px 14px" }}>
          {detailQ.isError && (
            <InlineBanner flush>{detailQ.error instanceof Error ? detailQ.error.message : String(detailQ.error)}</InlineBanner>
          )}
          {!detail && detailQ.isLoading && <Skeleton w={260} h={12} />}
          {detail && <ChartAbout detail={detail} installed={installed} />}
        </div>
      )}

      {tab === "readme" && (
        <div style={{ padding: "10px 14px" }}>
          {!detail && detailQ.isLoading && <Skeleton w={260} h={12} />}
          {detail && !detail.readme && <p className="muted small">This chart ships no README.</p>}
          {detail?.readme && <Markdown source={detail.readme} />}
        </div>
      )}

      {tab === "values" && (
        <div className="yaml-editor" style={{ height: "calc(100vh - 340px)" }}>
          {defaultsQ.isLoading ? (
            <Skeleton w={400} h={200} />
          ) : (
            <Editor
              value={valuesYaml}
              onChange={(v) => {
                setValues(v ?? "");
                touched();
              }}
              defaultLanguage="yaml"
              theme={monacoTheme}
              options={editorOptions}
            />
          )}
        </div>
      )}

      {tab === "preview" && preview && (
        <div className="yaml-editor" style={{ height: "calc(100vh - 340px)" }}>
          <p className="muted small" style={{ margin: "6px 14px" }}>
            {preview.current !== null
              ? `The running release on the left, what ${verb} would apply on the right. Secret values are hidden. Nothing has been applied.`
              : "What Install would create. Secret values are hidden. Nothing has been applied."}
          </p>
          {preview.current !== null ? (
            <DiffEditor
              original={preview.current}
              modified={preview.next}
              language="yaml"
              theme={monacoTheme}
              options={{ ...editorOptions, readOnly: true, renderSideBySide: true }}
            />
          ) : (
            <Editor value={preview.next} defaultLanguage="yaml" theme={monacoTheme} options={{ ...editorOptions, readOnly: true }} />
          )}
        </div>
      )}
    </Drawer>
  );
}

export function ChartsTab({ cluster }: { cluster: string }) {
  const qc = useQueryClient();
  const repos = useQuery({
    queryKey: ["helm-repos", cluster],
    queryFn: () => helmMarketApi.repos(cluster),
    retry: false,
  });
  // The release list the Helm page keeps live: it says which charts are installed.
  const releases = useQuery({ ...helmReleasesQuery(cluster), retry: false });
  const releaseList = releases.data?.releases;
  const [repoSel, setRepoSel] = useState("");
  const [search, setSearch] = useState("");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [hideDeprecated, setHideDeprecated] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [repoForm, setRepoForm] = useState({ name: "", url: "", username: "", password: "" });
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoErr, setRepoErr] = useState("");
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
    const keep = (c: HelmChartEntry) =>
      matchesChart(c, search) &&
      !(hideDeprecated && c.deprecated) &&
      !(installedOnly && installedAs(releaseList, c.name).length === 0);

    if (isAll && allItems) {
      return allItems
        .filter(({ chart }) => keep(chart))
        .sort((a, b) => a.chart.name.localeCompare(b.chart.name));
    }
    const out = (singleCharts.data ?? []).filter(keep);
    if (!search) out.sort((a, b) => a.name.localeCompare(b.name));
    return out.map((chart) => ({ chart, repoName: effectiveRepo }));
  }, [isAll, allItems, singleCharts.data, search, effectiveRepo, hideDeprecated, installedOnly, releaseList]);

  async function addRepo() {
    setRepoBusy(true);
    setRepoErr("");
    try {
      const { name, url, username, password } = repoForm;
      await helmMarketApi.addRepo({ name: name.trim(), url: url.trim(), ...(username ? { username, password } : {}) });
      setRepoForm({ name: "", url: "", username: "", password: "" });
      setAddOpen(false);
      setRepoSel(name.trim());
      await qc.invalidateQueries({ queryKey: ["helm-repos"] });
    } catch (e) {
      setRepoErr(String(e instanceof Error ? e.message : e));
    } finally {
      setRepoBusy(false);
    }
  }

  async function removeRepo(name: string) {
    setRepoBusy(true);
    setRepoErr("");
    try {
      await helmMarketApi.removeRepo(name);
      setRepoSel("");
      await qc.invalidateQueries({ queryKey: ["helm-repos"] });
      qc.removeQueries({ queryKey: ["helm-charts", cluster, name] });
    } catch (e) {
      setRepoErr(String(e instanceof Error ? e.message : e));
    } finally {
      setRepoBusy(false);
    }
  }

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
        <Select
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
        </Select>
        <TextField
          placeholder="Search charts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
        <label className="ctl">
          <input
            type="checkbox"
            checked={installedOnly}
            disabled={!releaseList}
            onChange={(e) => setInstalledOnly(e.target.checked)}
          />
          Installed only
        </label>
        <label className="ctl">
          <input type="checkbox" checked={hideDeprecated} onChange={(e) => setHideDeprecated(e.target.checked)} />
          Hide deprecated
        </label>
        <Button variant="ghost" disabled={updating || !repoList.length} onClick={() => void updateIndexes()}>
          {updating ? "Updating…" : "Update indexes"}
        </Button>
        <Button variant="ghost" onClick={() => setAddOpen((o) => !o)}>
          Add repository
        </Button>
        {!isAll && effectiveRepo && (
          <ArmedButton
            label="Remove repository"
            confirmLabel={`Confirm remove ${effectiveRepo}`}
            busy={repoBusy}
            onGo={() => void removeRepo(effectiveRepo)}
          />
        )}
        <Badge>{filtered.length}{isAll && loadingRepoCount > 0 ? "+" : ""}</Badge>
      </div>

      {addOpen && (
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addRepo();
            }}
          >
            <Stack gap={3}>
              <Row gap={2}>
                <TextField
                  aria-label="Repository name"
                  placeholder="name, e.g. bitnami"
                  value={repoForm.name}
                  onChange={(e) => setRepoForm({ ...repoForm, name: e.target.value })}
                  spellCheck={false}
                />
                <TextField
                  aria-label="Repository URL"
                  placeholder="https://charts.example.com"
                  value={repoForm.url}
                  onChange={(e) => setRepoForm({ ...repoForm, url: e.target.value })}
                  spellCheck={false}
                  style={{ flex: 1, minWidth: 240 }}
                />
              </Row>
              <Row gap={2}>
                <TextField
                  aria-label="Username (optional)"
                  placeholder="username (optional)"
                  value={repoForm.username}
                  onChange={(e) => setRepoForm({ ...repoForm, username: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
                <TextField
                  aria-label="Password (optional)"
                  type="password"
                  placeholder="password (optional)"
                  value={repoForm.password}
                  onChange={(e) => setRepoForm({ ...repoForm, password: e.target.value })}
                  autoComplete="off"
                />
              </Row>
              <p className="muted small" style={{ margin: 0 }}>
                The engine downloads this repository's index to check it, then saves it in your Helm config, with the password if you gave one.
                Only add repositories you trust: their charts are rendered and applied as you. Addresses the engine must not reach (cloud
                metadata, link-local) are refused. Removing a repository later does not touch releases installed from it.
              </p>
              {repoErr && <InlineBanner flush>{repoErr}</InlineBanner>}
              <Row gap={2}>
                <Button type="submit" disabled={repoBusy || !repoForm.name.trim() || !repoForm.url.trim()}>
                  {repoBusy ? "Adding…" : "Add"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAddOpen(false);
                    setRepoErr("");
                  }}
                >
                  Cancel
                </Button>
              </Row>
            </Stack>
          </form>
        </Card>
      )}

      {!addOpen && repoErr && <InlineBanner flush>{repoErr}</InlineBanner>}

      {updateMsg && (
        <p className="muted small" style={{ marginTop: -6, marginBottom: 10 }}>
          {updateMsg}
        </p>
      )}

      {!repoList.length && (
        <EmptyState>
          <p>No Helm repositories configured.</p>
          <p className="muted small">Kubebay reads your local helm config. Use Add repository above, or run "helm repo add …" once.</p>
        </EmptyState>
      )}

      {errorMessages.length > 0 && (
        <InlineBanner flush>
          {errorMessages.map((m, i) => <div key={i}>{m}</div>)}
        </InlineBanner>
      )}

      <div className="cluster-grid">
        {filtered.map(({ chart: c, repoName }) => (
          <Card key={`${repoName}/${c.name}`} interactive className="fleet-card">
            <div style={{ cursor: "pointer" }} onClick={() => setInstalling({ chart: c, repoName })}>
              <Row align="center" gap={2}>
                <Avatar name={c.name} />
                <strong>{c.name}</strong>
                <Badge>v{c.version}</Badge>
                {installedAs(releaseList, c.name).length > 0 && <Badge tone="ok">Installed</Badge>}
                {c.deprecated && <Badge tone="warn">Deprecated</Badge>}
                {c.versions > 1 && <span className="muted small mono">{c.versions} versions</span>}
              </Row>
              <p className="muted small" style={{ margin: "6px 0 0", minHeight: 30 }}>
                {c.description || "—"}
              </p>
              <Row gap={2} style={{ marginTop: 4 }}>
                {c.appVersion && <span className="muted small mono">app {c.appVersion}</span>}
                {isAll && <span className="muted small mono" style={{ marginLeft: "auto" }}>{repoName}</span>}
              </Row>
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
        // Keyed by chart: the release name, version and values it seeds belong
        // to one chart, and Install must never apply them to the next one opened.
        <ChartDrawer
          key={`${installing.repoName}/${installing.chart.name}`}
          cluster={cluster}
          repoName={installing.repoName}
          chart={installing.chart}
          releases={releaseList}
          onClose={() => setInstalling(null)}
        />
      )}
    </>
  );
}
