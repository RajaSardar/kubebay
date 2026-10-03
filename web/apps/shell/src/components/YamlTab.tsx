import { useCallback, useEffect, useState, type ReactNode } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { Badge, Button, InlineBanner, Row, SkeletonLines, TextField } from "@kubebay/ui";
import { api } from "../lib/api";
import { useMonacoTheme } from "../lib/theme";
import { ownerWarning, type GitOpsOwner } from "../lib/gitops";
import { PolicyRejectionError, StaleEditError, type PolicyRejectionDetail } from "../lib/policyRejection";
import { PolicyRejectionCard } from "./PolicyRejectionCard";

export function YamlTab({
  cluster,
  gvr,
  ns,
  name,
  gitopsOwner,
  helmRelease,
  impactBanner,
  dangerousChangeCheck,
}: {
  cluster: string;
  gvr: string;
  ns: string;
  name: string;
  gitopsOwner?: GitOpsOwner | null;
  /** The Helm release that installed this object (lib/gitops.ts#helmReleaseOf). */
  helmRelease?: string | null;
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
  // Fields the user edited that someone else changed after this editor loaded.
  const [staleFields, setStaleFields] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    setPolicyRejection(null);
    setServerPreview(null);
    setStaleFields(null);
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
        // Patch only what changed rather than re-applying the whole object.
        original,
        dryRun,
        force: false,
      });
      const n = r.changedPaths?.length ?? 0;
      const fields = `${n} field${n === 1 ? "" : "s"}`;
      if (r.noop) {
        setMsg({ ok: true, text: "Nothing to apply: no stored field changed." });
      } else if (r.dryRun) {
        setMsg({ ok: true, text: `Dry-run passed: the server accepted changes to ${fields}.` });
        if (r.resultYaml) {
          setServerPreview(r.resultYaml);
          setShowDiff(true);
        }
      } else {
        // Reload first: load() clears the message, which used to hide this one.
        await load();
        setMsg({ ok: true, text: `Applied: patched ${fields}.` });
      }
    } catch (e) {
      if (e instanceof PolicyRejectionError) {
        setPolicyRejection(e.rejection);
      } else if (e instanceof StaleEditError) {
        setStaleFields(e.paths);
      } else {
        setMsg({ ok: false, text: String(e instanceof Error ? e.message : e) });
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonLines lines={12} label="Loading YAML…" />;

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
        <Row gap={2} style={{ marginLeft: "auto" }}>
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
        </Row>
      </div>
      {impactBanner}
      {helmRelease && (
        <InlineBanner tone="warn" flush>
          {`Managed by Helm release ${helmRelease}. Edits apply now and only touch the fields you change, but the next helm upgrade or rollback of this release restores the chart's values. Change the release values to make an edit permanent.`}
        </InlineBanner>
      )}
      {gitopsOwner && (
        <InlineBanner role="alert">
          {ownerWarning(gitopsOwner)}
        </InlineBanner>
      )}
      {dirty && dangerousChanges.length > 0 && (
        <InlineBanner flush role="alert">
          <div>
            <strong>This change looks risky</strong>
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {dangerousChanges.map((c, i) => (
              <li key={i} className="small">{c.message}</li>
            ))}
          </ul>
          <Row align="center" gap={2} className="small" style={{ marginTop: 8 }}>
            <Badge tone="err">type name to confirm</Badge>
            <TextField
              style={{ maxWidth: 180 }}
              placeholder={name}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              spellCheck={false}
            />
          </Row>
        </InlineBanner>
      )}
      {staleFields && (
        <InlineBanner
          tone="warn"
          flush
          role="alert"
          actions={
            <Button variant="ghost" onClick={() => void load()}>
              Reload current version
            </Button>
          }
        >
          <div>
            <strong>Not applied:</strong> these fields changed on the cluster since you opened this editor. Reload to see
            the current values, then make your edit again.
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {staleFields.map((p) => (
              <li key={p} className="mono small">
                {p}
              </li>
            ))}
          </ul>
        </InlineBanner>
      )}
      {policyRejection && <PolicyRejectionCard rejection={policyRejection} />}
      <div className="yaml-editor">{editor}</div>
    </div>
  );
}
