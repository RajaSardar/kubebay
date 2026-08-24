import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card } from "@kubebay/ui";
import { settingsApi } from "../lib/api";
import { useTheme, type ThemeName } from "../lib/theme";

const THEMES: { id: ThemeName; label: string; hint: string; swatch: [string, string, string] }[] = [
  { id: "dusk", label: "Dusk", hint: "Dark · default", swatch: ["#0a0b10", "#171a24", "#5b8def"] },
  { id: "dawn", label: "Dawn", hint: "Light", swatch: ["#f7f8fb", "#ffffff", "#3067d6"] },
  { id: "system", label: "System", hint: "Follows OS", swatch: ["#101218", "#f7f8fb", "#5b8def"] },
  { id: "dusk-hc", label: "Dusk HC", hint: "High contrast dark", swatch: ["#000000", "#161616", "#7cabff"] },
  { id: "dawn-hc", label: "Dawn HC", hint: "High contrast light", swatch: ["#ffffff", "#f0f0f0", "#003fb3"] },
];

function KubeconfigSources() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const extras = settings.data?.extraKubeconfigs ?? [];
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
      {!extras.length && <p className="muted small">Default kubeconfig is loaded automatically. Add extra files below — they merge into the cluster list.</p>}
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

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      <div className="page-header" style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 14 }}>Appearance</h2>
      </div>

      <div className="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={theme === t.id ? "theme-card active" : "theme-card"}
            onClick={() => setTheme(t.id)}
          >
            <span
              className="swatch"
              style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 45%, ${t.swatch[1]} 55%)` }}
              ref={(el) => {
                if (!el) return;
                el.style.setProperty("--dot", t.swatch[2]);
              }}
            />
            <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <strong style={{ fontWeight: 600 }}>{t.label}</strong>
              <span className="muted small">{t.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="subtle small" style={{ marginBottom: 18 }}>
        Themes are token-driven — plugins inherit them read-only. Switching is flicker-free and persisted locally.
      </p>
      <Button variant="ghost" onClick={() => setTheme("system")}>
        Reset to system
      </Button>

      <KubeconfigSources />
      {settings.isSuccess && <PrometheusSettings initial={settings.data.prometheusUrl} />}
    </div>
  );
}
