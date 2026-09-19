import { useCallback, useEffect, useState } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { Badge, Button } from "@kubebay/ui";
import { api } from "../lib/api";
import { useMonacoTheme } from "../lib/theme";

export function YamlTab({
  cluster,
  gvr,
  ns,
  name,
}: {
  cluster: string;
  gvr: string;
  ns: string;
  name: string;
}) {
  const monacoTheme = useMonacoTheme();
  const [original, setOriginal] = useState("");
  const [modified, setModified] = useState("");
  const [loading, setLoading] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  // Server-computed YAML from a successful dry-run (what the cluster would store)
  const [serverPreview, setServerPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    setServerPreview(null);
    try {
      const y = await api.getYamlText(cluster, gvr, ns, name);
      setOriginal(y);
      setModified(y);
    } catch (e) {
      setMsg({ ok: false, text: String(e instanceof Error ? e.message : e) });
    } finally {
      setLoading(false);
    }
  }, [cluster, gvr, ns, name]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = modified !== original;

  // Clear server preview when user keeps editing
  function onEdit(v: string) {
    setModified(v);
    setServerPreview(null);
    setMsg(null);
  }

  async function apply(dryRun: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.applyYaml({
        cluster,
        gvr,
        ns,
        name,
        yaml: modified,
        dryRun,
        force: false,
      });
      if (r.dryRun) {
        setMsg({ ok: true, text: "Dry-run passed — server accepted the change." });
        if (r.resultYaml) {
          setServerPreview(r.resultYaml);
          setShowDiff(true);
        }
      } else {
        setMsg({ ok: true, text: "Applied via server-side apply." });
        await load();
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="loading-state">Loading YAML…</div>;

  // In diff mode: if we have a server preview, show live vs server-computed.
  // Otherwise show local edits vs original.
  const diffOriginal = original;
  const diffModified = serverPreview ?? modified;
  const diffLabel = serverPreview ? "server preview (dry-run)" : "local edits";

  const editor = showDiff ? (
    <DiffEditor
      original={diffOriginal}
      modified={diffModified}
      language="yaml"
      theme={monacoTheme}
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        automaticLayout: true,
      }}
    />
  ) : (
    <Editor
      value={modified}
      onChange={(v) => onEdit(v ?? "")}
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
  );

  return (
    <div className="yaml-tab">
      <div className="log-controls">
        <label className="ctl">
          <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} />
          diff view
        </label>
        {showDiff && (
          <span className="muted small">{diffLabel}</span>
        )}
        {dirty && !showDiff && <Badge>modified</Badge>}
        {msg && (
          <span className={`small ${msg.ok ? "" : "error-text"}`} style={{ color: msg.ok ? "var(--kb-status-ok)" : undefined }}>
            {msg.text}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={() => void load()}>
            Reload
          </Button>
          <Button variant="ghost" disabled={busy || !dirty} onClick={() => void apply(true)}>
            Dry-run
          </Button>
          <Button disabled={busy || !dirty} onClick={() => void apply(false)}>
            Apply
          </Button>
        </div>
      </div>
      <div className="yaml-editor">{editor}</div>
    </div>
  );
}
