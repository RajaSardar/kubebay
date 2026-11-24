import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CellLink, ChoiceCard, InlineBanner, PageHeader, SegmentedControl, Stack, TextField } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { settingsApi, promApi } from "../lib/api";
import ConfigurePrometheusModal from "../components/ConfigurePrometheusModal";
import { useCluster } from "../lib/useCluster";
import { UsageHistoryCard } from "../components/UsageHistoryCard";
import { McpSettingsCard } from "../components/McpSettingsCard";
import { TriageSettingsCard } from "../components/TriageSettingsCard";
import { WarmClustersCard } from "../components/WarmClustersCard";
import { ExtensionsCard } from "../components/ExtensionsCard";
import { UpdatesCard } from "../components/UpdatesCard";
import { SavedViewsCard } from "../components/SavedViews";
import { useTheme, type ThemeName } from "../lib/theme";
import { useDisplay, type FontSize, type FontFamily, type Density } from "../lib/display";

const THEMES: { id: ThemeName; label: string; hint: string; swatch: [string, string, string] }[] = [
  // ── Apple originals ──────────────────────────────────────────────────
  { id: "dawn",        label: "Dawn",         hint: "Light · default",      swatch: ["#f2f2f7", "#ffffff", "#005dba"] },
  { id: "dusk",        label: "Dusk",         hint: "Dark · macOS",         swatch: ["#161617", "#1c1c1e", "#32ade6"] },
  { id: "system",      label: "System",       hint: "Follows OS",           swatch: ["#161617", "#f2f2f7", "#32ade6"] },
  { id: "dusk-hc",     label: "Dusk HC",      hint: "High contrast dark",   swatch: ["#000000", "#141414", "#40c8e0"] },
  { id: "dawn-hc",     label: "Dawn HC",      hint: "High contrast light",  swatch: ["#ffffff", "#ffffff", "#004e9b"] },
  // ── VSCode ───────────────────────────────────────────────────────────
  { id: "vscode-dark",  label: "VS Dark+",    hint: "VSCode Dark+",         swatch: ["#1e1e1e", "#252526", "#31a6ff"] },
  { id: "vscode-light", label: "VS Light+",   hint: "VSCode Light+",        swatch: ["#f3f3f3", "#ffffff", "#0063b1"] },
  // ── Community favourites ─────────────────────────────────────────────
  { id: "one-dark",    label: "One Dark",     hint: "One Dark Pro",         swatch: ["#282c34", "#21252b", "#61afef"] },
  { id: "dracula",     label: "Dracula",      hint: "Dracula Official",     swatch: ["#282a36", "#21222c", "#bd93f9"] },
  { id: "nord",        label: "Nord",         hint: "Nord",                 swatch: ["#2e3440", "#3b4252", "#aed4de"] },
  { id: "github-dark", label: "GitHub Dark",  hint: "GitHub Dark",          swatch: ["#0d1117", "#161b22", "#58a6ff"] },
  { id: "github-light",label: "GitHub Light", hint: "GitHub Light",         swatch: ["#f6f8fa", "#ffffff", "#0964d0"] },
  { id: "catppuccin",  label: "Catppuccin",   hint: "Catppuccin Mocha",     swatch: ["#1e1e2e", "#181825", "#cba6f7"] },
  // ── Soft and light ───────────────────────────────────────────────────
  { id: "blossom",     label: "Blossom",      hint: "Light · soft pink",    swatch: ["#fdeff4", "#fffbfd", "#a81f66"] },
];

/**
 * The Prometheus URL for clusters without their own. A cluster's own URL is set
 * from its details on the Clusters page, since a port-forward usually reaches
 * one cluster's Prometheus.
 */
function PrometheusSettings({ initial, initialPerCluster, cluster, locked }: { initial?: string; initialPerCluster?: Record<string, string>; cluster?: string; locked: boolean }) {
  const status = useQuery({
    queryKey: ["prom-status", cluster],
    queryFn: async () => await promApi.status(cluster ?? ""),
    enabled: !!cluster,
    staleTime: 60_000,
  });
  const [changing, setChanging] = useState(false);
  const [url, setUrl] = useState(initial ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const qc = useQueryClient();
  const overrides = Object.entries(initialPerCluster ?? {}).filter(([, v]) => v);

  async function save() {
    setErr("");
    try {
      const cur = await settingsApi.get();
      const trimmed = url.trim();
      await settingsApi.save({ ...cur, prometheusUrl: trimmed });
      setSaved(trimmed);
      await qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <Card style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Prometheus (history graphs)</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        The default for clusters without their own URL. Each cluster&apos;s own URL is set from its ⋮ menu on the Clusters page.
      </p>
      <p className="small muted">
        With no URL set, Kubebay looks for a Prometheus in each cluster and reads it through the cluster&apos;s API server. A URL you set always wins.
      </p>
      {cluster && status.data?.source === "auto" && (
        <p className="small">
          Auto-detected for {cluster}: <span className="mono">{status.data.target}</span>{" "}
          <Button variant="ghost" aria-label={`Change Prometheus for ${cluster}`} disabled={locked} onClick={() => setChanging(true)}>
            Change
          </Button>
        </p>
      )}
      {cluster && status.data?.source === "manual" && (
        <p className="small muted">Using your own URL for {cluster}.</p>
      )}
      {cluster && status.data?.source === "none" && (
        <p className="small muted">No Prometheus was found in {cluster}. Set a URL below, or from its ⋮ menu on the Clusters page.</p>
      )}
      {changing && cluster && (
        <ConfigurePrometheusModal
          cluster={cluster}
          onClose={() => setChanging(false)}
          onSaved={() => {
            setChanging(false);
            void qc.invalidateQueries({ queryKey: ["prom-status", cluster] });
            void qc.invalidateQueries({ queryKey: ["settings"] });
          }}
        />
      )}
      <div className="pf-form">
        <TextField
          aria-label="Default Prometheus URL"
          placeholder="http://localhost:9090"
          value={url}
          disabled={locked}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          style={{ gridColumn: "span 4" }}
        />
        <Button aria-label="Save default Prometheus URL" disabled={locked} onClick={() => void save()}>Save</Button>
      </div>
      {overrides.length > 0 && (
        <ul className="small muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {overrides.map(([c, u]) => (
            <li key={c}><span className="mono">{c}</span> → <span className="mono">{u}</span></li>
          ))}
        </ul>
      )}
      {(saved != null || err) && (
        <p className={`small ${err ? "error-text" : "muted"}`} style={{ marginBottom: 0 }}>
          {err || (saved === "" ? "Default cleared." : `Saved. Clusters without their own URL now query ${saved}`)}
        </p>
      )}
    </Card>
  );
}

/** Kubeconfig files are managed on the cluster list now; this points there. */
function KubeconfigPointer() {
  const navigate = useNavigate();
  const to = "/clusters?kubeconfig=1";
  return (
    <Card id="kubeconfig-sources" style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Kubeconfig sources</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Kubeconfig files are added and removed on the Clusters page, next to the clusters they bring in.
      </p>
      <CellLink
        href={to}
        onClick={(e) => {
          e.preventDefault();
          navigate(to);
        }}
      >
        Manage kubeconfig files
      </CellLink>
    </Card>
  );
}

function NodeShellSettings({ initial, fallback, locked }: { initial?: string; fallback: string; locked: boolean }) {
  const [image, setImage] = useState(initial ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const qc = useQueryClient();

  useEffect(() => {
    if (initial != null && saved == null) setImage(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  async function save() {
    setErr("");
    try {
      const cur = await settingsApi.get();
      await settingsApi.save({
        prometheusUrl: cur.prometheusUrl,
        prometheusUrls: cur.prometheusUrls,
        extraKubeconfigs: cur.extraKubeconfigs,
        onlyListedKubeconfigs: cur.onlyListedKubeconfigs,
        nodeShellImage: image.trim(),
      });
      setSaved(image.trim());
      await qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <Card style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Node shell image</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Image used for the privileged node-shell pod. Set this to a mirror in your own
        registry if the cluster cannot pull from registry.k8s.io.
      </p>
      <div className="pf-form">
        <TextField
          aria-label="Node shell image"
          placeholder={fallback}
          value={image}
          disabled={locked}
          onChange={(e) => setImage(e.target.value)}
          spellCheck={false}
          style={{ gridColumn: "span 4" }}
        />
        <Button aria-label="Save node shell image" disabled={locked} onClick={() => void save()}>Save</Button>
      </div>
      {(saved != null || err) && (
        <p className={`small ${err ? "error-text" : "muted"}`} style={{ marginBottom: 0 }}>
          {err || (saved === "" ? `Cleared — using the default ${fallback}` : `Saved. Node shell will use ${saved}`)}
        </p>
      )}
    </Card>
  );
}

function DebugImageSettings({ initial, fallback, locked }: { initial?: string; fallback: string; locked: boolean }) {
  const [image, setImage] = useState(initial ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const qc = useQueryClient();

  useEffect(() => {
    if (initial != null && saved == null) setImage(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  async function save() {
    setErr("");
    try {
      const cur = await settingsApi.get();
      await settingsApi.save({
        prometheusUrl: cur.prometheusUrl,
        prometheusUrls: cur.prometheusUrls,
        extraKubeconfigs: cur.extraKubeconfigs,
        onlyListedKubeconfigs: cur.onlyListedKubeconfigs,
        debugImage: image.trim(),
      });
      setSaved(image.trim());
      await qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <Card style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Debug image</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Image offered by Debug with ephemeral container in a pod's Terminal tab. Pick one with the tools you need (a shell,
        curl, dig), or a mirror in your own registry if the cluster cannot pull from the public one.
      </p>
      <div className="pf-form">
        <TextField
          aria-label="Debug image"
          placeholder={fallback}
          value={image}
          disabled={locked}
          onChange={(e) => setImage(e.target.value)}
          spellCheck={false}
          style={{ gridColumn: "span 4" }}
        />
        <Button disabled={locked} onClick={() => void save()}>Save debug image</Button>
      </div>
      {(saved != null || err) && (
        <p className={`small ${err ? "error-text" : "muted"}`} style={{ marginBottom: 0 }}>
          {err || (saved === "" ? `Cleared — using the default ${fallback}` : `Saved. Debug containers will use ${saved}`)}
        </p>
      )}
    </Card>
  );
}

function OptionRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="settings-option-row">
      <span className="settings-option-label">{label}</span>
      <SegmentedControl label={label} options={options.map((o) => ({ value: o.id, label: o.label }))} value={value} onChange={onChange} />
    </div>
  );
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { fontSize, fontFamily, density, setFontSize, setFontFamily, setDensity } = useDisplay();
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  // A shared engine (in a cluster or with OIDC): one user's settings would
  // apply to everyone, so the operator sets them and the engine refuses saves.
  const sharedLocked = settings.data?.sharedLocked ?? "";
  const { cluster } = useCluster();
  const location = useLocation();

  // Deep-link support: /settings#kubeconfig-sources scrolls that card into view.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  // Split themes into groups for layout
  const appleThemes = THEMES.filter((t) => ["dawn", "dusk", "system", "dusk-hc", "dawn-hc"].includes(t.id));
  const communityThemes = THEMES.filter((t) => !appleThemes.includes(t));

  return (
    <div className="page" style={{ overflowY: "auto" }}>
      <PageHeader help={<PageHelp route="/settings" />} title="Settings" />
      {sharedLocked && (
        <InlineBanner tone="warn" style={{ marginBottom: 12 }}>
          {sharedLocked}
        </InlineBanner>
      )}

      <div className="settings-section-wrap">
        <div className="settings-section-title">Theme</div>

        <p className="muted small" style={{ marginBottom: 10 }}>Apple</p>
        <div className="theme-grid" style={{ marginBottom: 16 }}>
          {appleThemes.map((t) => (
            <ChoiceCard key={t.id} selected={theme === t.id} onClick={() => setTheme(t.id)}>
              <ThemeSwatch t={t} />
              <ThemeLabel t={t} />
            </ChoiceCard>
          ))}
        </div>

        <p className="muted small" style={{ marginBottom: 10 }}>Community favourites</p>
        <div className="theme-grid">
          {communityThemes.map((t) => (
            <ChoiceCard key={t.id} selected={theme === t.id} onClick={() => setTheme(t.id)}>
              <ThemeSwatch t={t} />
              <ThemeLabel t={t} />
            </ChoiceCard>
          ))}
        </div>

        <Button variant="ghost" style={{ marginTop: 12 }} onClick={() => setTheme("system")}>Reset to system</Button>
      </div>

      <div className="settings-section-wrap">
        <div className="settings-section-title">Display</div>
        <OptionRow<FontSize>
          label="Font size"
          value={fontSize}
          options={[
            { id: "sm", label: "S (13px)" },
            { id: "md", label: "M (14px)" },
            { id: "lg", label: "L (15px)" },
            { id: "xl", label: "XL (16px)" },
          ]}
          onChange={setFontSize}
        />
        <OptionRow<FontFamily>
          label="Font family"
          value={fontFamily}
          options={[
            { id: "system", label: "Roboto (default)" },
            { id: "jetbrains", label: "JetBrains Mono" },
            { id: "mono", label: "System Mono" },
          ]}
          onChange={setFontFamily}
        />
        <OptionRow<Density>
          label="Table density"
          value={density}
          options={[
            { id: "compact", label: "Compact" },
            { id: "default", label: "Default" },
            { id: "relaxed", label: "Relaxed" },
          ]}
          onChange={setDensity}
        />
      </div>

      <KubeconfigPointer />
      {settings.isSuccess && (
        <PrometheusSettings
          initial={settings.data.prometheusUrl}
          initialPerCluster={settings.data.prometheusUrls}
          cluster={cluster}
          locked={!!sharedLocked}
        />
      )}
      {settings.isSuccess && (
        <NodeShellSettings
          initial={settings.data.nodeShellImage}
          fallback={settings.data.nodeShellImageDefault ?? ""}
          locked={!!sharedLocked}
        />
      )}
      {settings.isSuccess && (
        <DebugImageSettings
          initial={settings.data.debugImage}
          fallback={settings.data.debugImageDefault ?? ""}
          locked={!!sharedLocked}
        />
      )}
      {settings.isSuccess && <UsageHistoryCard clusters={settings.data.historyClusters ?? {}} />}
      <McpSettingsCard />
      <TriageSettingsCard />
      <WarmClustersCard />
      <ExtensionsCard />
      <UpdatesCard />
      <SavedViewsCard />
    </div>
  );
}

function ThemeSwatch({ t }: { t: typeof THEMES[0] }) {
  return (
    <span
      className="swatch"
      style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 45%, ${t.swatch[1]} 55%)` }}
      ref={(el) => { if (el) el.style.setProperty("--dot", t.swatch[2]); }}
    />
  );
}

function ThemeLabel({ t }: { t: typeof THEMES[0] }) {
  return (
    <Stack as="span">
      <strong style={{ fontWeight: 600 }}>{t.label}</strong>
      <span className="muted small">{t.hint}</span>
    </Stack>
  );
}
