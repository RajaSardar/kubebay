import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card } from "@kubebay/ui";
import { settingsApi } from "../lib/api";
import { useTheme, type ThemeName } from "../lib/theme";
import { useDisplay, type FontSize, type FontFamily, type Density } from "../lib/display";

const THEMES: { id: ThemeName; label: string; hint: string; swatch: [string, string, string] }[] = [
  // ── Apple originals ──────────────────────────────────────────────────
  { id: "dawn",        label: "Dawn",         hint: "Light · default",      swatch: ["#f2f2f7", "#ffffff", "#0077ed"] },
  { id: "dusk",        label: "Dusk",         hint: "Dark · macOS",         swatch: ["#161617", "#1c1c1e", "#32ade6"] },
  { id: "system",      label: "System",       hint: "Follows OS",           swatch: ["#161617", "#f2f2f7", "#32ade6"] },
  { id: "dusk-hc",     label: "Dusk HC",      hint: "High contrast dark",   swatch: ["#000000", "#141414", "#40c8e0"] },
  { id: "dawn-hc",     label: "Dawn HC",      hint: "High contrast light",  swatch: ["#ffffff", "#f0f0f0", "#006bd6"] },
  // ── VSCode ───────────────────────────────────────────────────────────
  { id: "vscode-dark",  label: "VS Dark+",    hint: "VSCode Dark+",         swatch: ["#1e1e1e", "#252526", "#0078d4"] },
  { id: "vscode-light", label: "VS Light+",   hint: "VSCode Light+",        swatch: ["#f3f3f3", "#ffffff", "#0078d4"] },
  // ── Community favourites ─────────────────────────────────────────────
  { id: "one-dark",    label: "One Dark",     hint: "One Dark Pro",         swatch: ["#282c34", "#21252b", "#61afef"] },
  { id: "dracula",     label: "Dracula",      hint: "Dracula Official",     swatch: ["#282a36", "#21222c", "#bd93f9"] },
  { id: "nord",        label: "Nord",         hint: "Nord",                 swatch: ["#2e3440", "#3b4252", "#88c0d0"] },
  { id: "github-dark", label: "GitHub Dark",  hint: "GitHub Dark",          swatch: ["#0d1117", "#161b22", "#58a6ff"] },
  { id: "github-light",label: "GitHub Light", hint: "GitHub Light",         swatch: ["#f6f8fa", "#ffffff", "#0969da"] },
  { id: "catppuccin",  label: "Catppuccin",   hint: "Catppuccin Mocha",     swatch: ["#1e1e2e", "#181825", "#cba6f7"] },
];

function KubeconfigSources() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const extras = settings.data?.extraKubeconfigs ?? [];
  const active = settings.data?.activeKubeconfigs ?? [];
  const isolated = settings.data?.onlyListedKubeconfigs ?? false;

  async function persist(next: string[], onlyListed?: boolean) {
    setErr("");
    setMsg("");
    try {
      await settingsApi.save({
        prometheusUrl: settings.data?.prometheusUrl ?? "",
        extraKubeconfigs: next,
        onlyListedKubeconfigs: onlyListed ?? isolated,
      });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["clusters"] });
      setMsg("Saved — clusters reloading.");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <Card style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Kubeconfig sources</div>

      {/* Active files being loaded */}
      {active.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p className="muted small" style={{ marginBottom: 6 }}>Active kubeconfig files (currently loaded):</p>
          {active.map((p) => (
            <div key={p} className="rbac-subject" style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontFamily: "var(--kb-font-mono)", background: "var(--kb-status-ok-subtle)", color: "var(--kb-status-ok-fg)", padding: "1px 6px", borderRadius: 4, marginRight: 8, flexShrink: 0 }}>active</span>
              <span className="mono small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{p}</span>
            </div>
          ))}
        </div>
      )}

      {/* Extra kubeconfig files */}
      {extras.map((p) => (
        <div key={p} className="rbac-subject" style={{ marginBottom: 6 }}>
          <span className="mono small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{p}</span>
          <Button
            variant="ghost"
            className="kb-btn-danger-ghost"
            onClick={() => void persist(extras.filter((x) => x !== p))}
          >
            Remove
          </Button>
        </div>
      ))}

      <div className="rbac-subject" style={{ marginBottom: 6 }}>
        <label className="ctl" style={{ cursor: "pointer", flex: 1 }}>
          <input
            type="checkbox"
            checked={isolated}
            onChange={(e) => void persist(extras, e.target.checked)}
          />
          Use only the files listed above (ignore default ~/.kube/config and KUBECONFIG)
        </label>
      </div>
      {!extras.length && <p className="muted small">Default kubeconfig is loaded automatically. Add extra files below to merge additional clusters.</p>}
      <div className="pf-form">
        <input
          className="toolbar-input"
          placeholder="/path/to/another/kubeconfig"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          style={{ gridColumn: "span 4" }}
        />
        <Button
          disabled={!draft.trim()}
          onClick={() => {
            void persist([...extras, draft.trim()]).then(() => setDraft(""));
          }}
        >
          Add file
        </Button>
      </div>
      {(msg || err) && (
        <p className={`small ${err ? "error-text" : "muted"}`} style={{ marginBottom: 0 }}>
          {err || msg}
        </p>
      )}
    </Card>
  );
}

function PrometheusSettings({ initial }: { initial?: string }) {
  const [url, setUrl] = useState(initial ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const qc = useQueryClient();

  useEffect(() => {
    if (initial != null && saved == null) setUrl(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  async function save() {
    setErr("");
    try {
      const cur = await settingsApi.get();
      await settingsApi.save({ prometheusUrl: url.trim(), extraKubeconfigs: cur.extraKubeconfigs });
      setSaved(url.trim());
      await qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <Card style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Prometheus (history graphs)</div>
      <div className="pf-form">
        <input
          className="toolbar-input"
          placeholder="http://prometheus.monitoring:9090"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          style={{ gridColumn: "span 4" }}
        />
        <Button onClick={() => void save()}>Save</Button>
      </div>
      {(saved != null || err) && (
        <p className={`small ${err ? "error-text" : "muted"}`} style={{ marginBottom: 0 }}>
          {err || (saved === "" ? "Cleared — graphs hidden." : `Saved. Pod drawer Graphs tab now queries ${saved}`)}
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
      <div className="settings-option-group">
        {options.map((o) => (
          <button
            key={o.id}
            className={value === o.id ? "settings-chip active" : "settings-chip"}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { fontSize, fontFamily, density, setFontSize, setFontFamily, setDensity } = useDisplay();
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });

  // Split themes into groups for layout
  const appleThemes = THEMES.filter((t) => ["dawn", "dusk", "system", "dusk-hc", "dawn-hc"].includes(t.id));
  const communityThemes = THEMES.filter((t) => !appleThemes.includes(t));

  return (
    <div className="page" style={{ overflowY: "auto" }}>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-section-wrap">
        <div className="settings-section-title">Theme</div>

        <p className="muted small" style={{ marginBottom: 10 }}>Apple</p>
        <div className="theme-grid" style={{ marginBottom: 16 }}>
          {appleThemes.map((t) => (
            <button key={t.id} className={theme === t.id ? "theme-card active" : "theme-card"} onClick={() => setTheme(t.id)}>
              <ThemeSwatch t={t} />
              <ThemeLabel t={t} />
            </button>
          ))}
        </div>

        <p className="muted small" style={{ marginBottom: 10 }}>Community favourites</p>
        <div className="theme-grid">
          {communityThemes.map((t) => (
            <button key={t.id} className={theme === t.id ? "theme-card active" : "theme-card"} onClick={() => setTheme(t.id)}>
              <ThemeSwatch t={t} />
              <ThemeLabel t={t} />
            </button>
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
            { id: "xs", label: "XS (11px)" },
            { id: "sm", label: "S (12px)" },
            { id: "md", label: "M (13px)" },
            { id: "lg", label: "L (14px)" },
          ]}
          onChange={setFontSize}
        />
        <OptionRow<FontFamily>
          label="Font family"
          value={fontFamily}
          options={[
            { id: "system", label: "Inter (default)" },
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

      <KubeconfigSources />
      {settings.isSuccess && <PrometheusSettings initial={settings.data.prometheusUrl} />}
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
    <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <strong style={{ fontWeight: 600 }}>{t.label}</strong>
      <span className="muted small">{t.hint}</span>
    </span>
  );
}
