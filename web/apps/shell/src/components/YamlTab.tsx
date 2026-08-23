import { useCallback, useEffect, useState } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { Badge, Button } from "@kubebay/ui";
import { api } from "../lib/api";

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
  const [original, setOriginal] = useState("");
  const [modified, setModified] = useState("");
  const [loading, setLoading] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
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
      setMsg(
        r.dryRun
          ? { ok: true, text: "Dry-run passed — server accepted the change." }
          : { ok: true, text: "Applied via server-side apply." },
      );
      if (!r.dryRun) {
        await load();
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="muted small" style={{ padding: 14 }}>Loading YAML…</div>;

  const editor = showDiff ? (
    <DiffEditor
      original={original}
      modified={modified}
      language="yaml"
      theme="vs-dark"
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
      onChange={(v) => setModified(v ?? "")}
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
  );

  return (
    <div className="yaml-tab">
      <div className="log-controls">
        <label className="ctl">
          <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} />
          diff view
        </label>
        {dirty && <Badge>modified</Badge>}
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
