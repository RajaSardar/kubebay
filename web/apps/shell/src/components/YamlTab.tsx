import { useCallback, useEffect, useState, type ReactNode } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { Badge, Button } from "@kubebay/ui";
import { api } from "../lib/api";
import { useMonacoTheme } from "../lib/theme";
import { ownerWarning, type GitOpsOwner } from "../lib/gitops";
import { PolicyRejectionError, type PolicyRejectionDetail } from "../lib/policyRejection";

export function YamlTab({
  cluster,
  gvr,
  ns,
  name,
  gitopsOwner,
  impactBanner,
  dangerousChangeCheck,
}: {
  cluster: string;
  gvr: string;
  ns: string;
  name: string;
  gitopsOwner?: GitOpsOwner | null;
  /** Optional blast-radius context (e.g. Karpenter's NodePool impact banner) shown above the editor. */
  impactBanner?: ReactNode;
  /**
   * Optional gate: when it finds anything on the current edit, Apply is
   * disabled until the user types the resource's name to confirm. Dry-run
   * stays enabled — it never mutates the cluster.
   */
  dangerousChangeCheck?: (original: string, modified: string) => { message: string }[];
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
  const [policyRejection, setPolicyRejection] = useState<PolicyRejectionDetail | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    setPolicyRejection(null);
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
  const dangerousChanges = dangerousChangeCheck ? dangerousChangeCheck(original, modified) : [];
  const needsConfirm = dangerousChanges.length > 0 && confirmText.trim() !== name;

  // Clear server preview when user keeps editing
  function onEdit(v: string) {
    setModified(v);
    setServerPreview(null);
    setMsg(null);
    setPolicyRejection(null);
    setConfirmText("");
  }

  // Discards the in-progress edit and reloads the last-fetched version —
  // purely local, unlike Reload which re-fetches from the server.
  function revert() {
    setModified(original);
    setServerPreview(null);
    setMsg(null);
    setPolicyRejection(null);
    setConfirmText("");
  }

  async function apply(dryRun: boolean) {
    setBusy(true);
    setMsg(null);
    setPolicyRejection(null);
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
      if (e instanceof PolicyRejectionError) {
        setPolicyRejection(e.rejection);
      } else {
        setMsg({ ok: false, text: String(e instanceof Error ? e.message : e) });
      }
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
          <Button variant="ghost" disabled={!dirty} onClick={revert}>
            Revert
          </Button>
          <Button variant="ghost" disabled={busy || !dirty} onClick={() => void apply(true)}>
            Dry-run
          </Button>
          <Button disabled={busy || !dirty || needsConfirm} onClick={() => void apply(false)}>
            Apply
          </Button>
        </div>
      </div>
      {impactBanner}
      {gitopsOwner && (
        <div className="inline-banner" role="alert">
          {ownerWarning(gitopsOwner)}
        </div>
      )}
      {dirty && dangerousChanges.length > 0 && (
        <div className="error-banner" role="alert">
          <div>
            <strong>This change looks risky</strong>
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {dangerousChanges.map((c, i) => (
              <li key={i} className="small">{c.message}</li>
            ))}
          </ul>
          <div className="small" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <Badge tone="err">type name to confirm</Badge>
            <input
              className="toolbar-input"
              style={{ maxWidth: 180 }}
              placeholder={name}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
      )}
      {policyRejection && (
        <div className="error-banner" role="alert">
          <div>
            <strong>
              {policyRejection.engine ? `${policyRejection.engine} policy rejected this change` : "Policy rejected this change"}
            </strong>
            {policyRejection.webhook && (
              <span className="muted small mono" style={{ marginLeft: 8 }}>{policyRejection.webhook}</span>
            )}
          </div>
          <div className="small">{policyRejection.message}</div>
          {policyRejection.causes && policyRejection.causes.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {policyRejection.causes.map((c, i) => (
                <li key={i} className="small">
                  {c.field && <span className="mono muted">{c.field}: </span>}
                  {c.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="yaml-editor">{editor}</div>
    </div>
  );
}
