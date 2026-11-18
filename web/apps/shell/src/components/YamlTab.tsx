import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Editor, { DiffEditor } from "../lib/monaco";
import { Badge, Button, InlineBanner, Row, SkeletonLines, TextField } from "@kubebay/ui";
import { api, ObjectNotFoundError } from "../lib/api";
import { clearDraft, readDraft, writeDraft, type EditDraft } from "../lib/editRecovery";
import { useTerminalDock } from "../lib/terminalDock";
import { useMonacoTheme } from "../lib/theme";
import { ownerWarning, type GitOpsOwner } from "../lib/gitops";
import { PolicyRejectionError, StaleEditError, type PolicyRejectionDetail } from "../lib/policyRejection";
import { PolicyRejectionCard } from "./PolicyRejectionCard";
import { ProdApplyModal } from "./ProdApplyModal";
import { setEditDirty } from "../lib/editGuard";
import { useClusterLooksProduction } from "../lib/useClusterLooksProduction";

export function YamlTab({
  cluster,
  gvr,
  ns,
  name,
  gitopsOwner,
  helmRelease,
  impactBanner,
  dangerousChangeCheck,
  dock = false,
  offline = false,
  watch = false,
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
  /** Hosted in the bottom dock: Cmd/Ctrl+S applies (backlog 51). */
  dock?: boolean;
  /** The cluster is not connected: Apply and Dry-run stay disabled. */
  offline?: boolean;
  /** Re-read the object when the window regains focus (or this tab is shown) and say if it changed. */
  watch?: boolean;
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
  // The live text when it differs from what this editor loaded and there are unapplied edits.
  const [liveText, setLiveText] = useState<string | null>(null);
  const [showLive, setShowLive] = useState(false);
  // A Secret's values stay hidden until asked for; asking is audited by the engine.
  const isSecret = gvr === "v1/secrets";
  const guardKey = `${cluster}/${gvr}/${ns}/${name}`;
  // Unsaved text kept from before a reload or crash (editRecovery.ts), offered once the object has loaded.
  const [draft, setDraft] = useState<EditDraft | null>(() => readDraft(guardKey));
  // The object is gone from the cluster while this editor is open.
  const [deleted, setDeleted] = useState(false);
  const [confirmingRecreate, setConfirmingRecreate] = useState(false);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => setRevealed(false), [cluster, gvr, ns, name]);

  const load = useCallback(async (reveal = revealed) => {
    setLoading(true);
    setMsg(null);
    setPolicyRejection(null);
    setServerPreview(null);
    setStaleFields(null);
    setLiveText(null);
    setShowLive(false);
    try {
      const y = await (reveal ? api.getYamlText(cluster, gvr, ns, name, { reveal: true }) : api.getYamlText(cluster, gvr, ns, name));
      setOriginal(y);
      setModified(y);
      setDeleted(false);
    } catch (e) {
      if (e instanceof ObjectNotFoundError) setDeleted(true);
      else setMsg({ ok: false, text: String(e instanceof Error ? e.message : e) });
    } finally {
      setLoading(false);
    }
  }, [cluster, gvr, ns, name, revealed]);

  useEffect(() => {
    void load();
  }, [load]);

  function reveal() {
    setRevealed(true); // load() runs again with the real values
  }

  const dirty = modified !== original;
  const seen = useRef({ original, dirty, loading, revealed });
  seen.current = { original, dirty, loading, revealed };

  // A tab left open in the dock goes stale: look again when the window regains focus.
  useEffect(() => {
    if (!watch) return;
    const check = async () => {
      const at = seen.current;
      if (at.loading || at.original === "") return;
      let live: string;
      try {
        live = await (at.revealed ? api.getYamlText(cluster, gvr, ns, name, { reveal: true }) : api.getYamlText(cluster, gvr, ns, name));
      } catch (e) {
        if (e instanceof ObjectNotFoundError) setDeleted(true);
        return; // unreachable: the cluster banner and Reload say so
      }
      setDeleted(false);
      const now = seen.current;
      if (live === now.original) setLiveText(null);
      else if (now.dirty) setLiveText(live);
      else {
        setOriginal(live);
        setModified(live);
        setLiveText(null);
      }
    };
    void check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [watch, cluster, gvr, ns, name]);
  // Tell the drawer and tab strip around us there is an edit to protect.
  useEffect(() => {
    setEditDirty(guardKey, dirty);
    return () => setEditDirty(guardKey, false);
  }, [guardKey, dirty]);
  // Keep the unapplied text for this window, so a reload or crash can offer it back. Cleared when
  // the edit is applied, reverted or reloaded away, and when you choose Discard.
  useEffect(() => {
    if (dirty) writeDraft(guardKey, { text: modified, original });
  }, [guardKey, dirty, modified, original]);
  // The dock's text budget counts what this editor holds.
  const reportSize = useTerminalDock((s) => s.reportSize);
  useEffect(() => {
    if (dock) reportSize(guardKey, original.length + modified.length);
  }, [dock, guardKey, original, modified, reportSize]);
  const prod = useClusterLooksProduction(cluster);
  const [confirmingProd, setConfirmingProd] = useState(false);
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
    forgetDraft();
  }

  function forgetDraft() {
    clearDraft(guardKey);
    setDraft(null);
  }
  // Reload and Load latest drop the edit, so the kept copy goes with it.
  async function reloadClean() {
    forgetDraft();
    await load();
  }

  // The object is gone: create it again from the text in the editor, through the create path.
  async function recreate() {
    setBusy(true);
    setMsg(null);
    setPolicyRejection(null);
    try {
      await api.createResource({ cluster, yaml: modified, dryRun: false });
      forgetDraft();
      await load();
      setMsg({ ok: true, text: "Re-created from your text." });
    } catch (e) {
      if (e instanceof PolicyRejectionError) setPolicyRejection(e.rejection);
      else setMsg({ ok: false, text: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(false);
    }
  }

  const canApply = !busy && dirty && !needsConfirm && !offline && !deleted;
  function applyOrConfirm() {
    if (prod.production) setConfirmingProd(true);
    else void apply(false);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!dock || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
    e.preventDefault();
    if (canApply) applyOrConfirm();
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
        forgetDraft();
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
  const diffModified = showLive && liveText !== null ? liveText : serverPreview ?? modified;
  const diffLabel = showLive && liveText !== null ? "changed on the cluster" : serverPreview ? "server preview (dry-run)" : "local edits";

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
    <div className="yaml-tab" onKeyDown={onKeyDown}>
      <div className="log-controls">
        <label className="ctl">
          <input type="checkbox" checked={showDiff} onChange={(e) => {
              setShowDiff(e.target.checked);
              setShowLive(false);
            }} />
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
          <Button variant="ghost" onClick={() => void reloadClean()}>
            Reload
          </Button>
          <Button variant="ghost" disabled={!dirty} onClick={revert}>
            Revert
          </Button>
          <Button variant="ghost" disabled={busy || !dirty || offline || deleted} onClick={() => void apply(true)}>
            Dry-run
          </Button>
          <Button
            disabled={!canApply}
            onClick={applyOrConfirm}
          >
            Apply
          </Button>
        </Row>
      </div>
      {impactBanner}
      {deleted && (
        <InlineBanner
          tone="warn"
          flush
          role="alert"
          actions={
            <Button
              disabled={busy || offline || modified.trim() === ""}
              onClick={() => (prod.production ? setConfirmingRecreate(true) : void recreate())}
            >
              Re-create from this text
            </Button>
          }
        >
          <strong>Deleted on the cluster.</strong> This object no longer exists, so Apply and Dry-run are off. Your text is still
          here: copy it out, or create the object again from it.
        </InlineBanner>
      )}
      {draft && !dirty && draft.text !== original && (
        <InlineBanner
          tone="warn"
          flush
          actions={
            <>
              <Button onClick={() => setModified(draft.text)}>Restore unsaved edit</Button>
              <Button variant="ghost" onClick={forgetDraft}>
                Discard saved edit
              </Button>
            </>
          }
        >
          <strong>You had an unsaved edit to this object.</strong> Kubebay kept it from before this window reloaded.
          {draft.original !== original && " The object has changed since; applying still refuses fields that changed under you."}
        </InlineBanner>
      )}
      {isSecret && !revealed && (
        <InlineBanner
          tone="warn"
          flush
          actions={<Button onClick={reveal}>Reveal values</Button>}
        >
          This Secret's values are hidden. Reveal them to read or edit them; the reveal is recorded in the Audit Log.
        </InlineBanner>
      )}
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
      {liveText !== null && (
        <InlineBanner
          tone="warn"
          flush
          role="alert"
          actions={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowLive(true);
                  setShowDiff(true);
                }}
              >
                Show changes
              </Button>
              <Button variant="ghost" onClick={() => void reloadClean()}>
                Load latest
              </Button>
            </>
          }
        >
          <strong>Changed on the cluster since you opened this.</strong> Your edit is untouched. Show changes compares the live
          object with what you loaded; Load latest discards your edit and reloads.
        </InlineBanner>
      )}
      {staleFields && (
        <InlineBanner
          tone="warn"
          flush
          role="alert"
          actions={
            <Button variant="ghost" onClick={() => void reloadClean()}>
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
      {confirmingProd && (
        <ProdApplyModal
          context={prod.context}
          target={`your edit to ${name}`}
          onCancel={() => setConfirmingProd(false)}
          onConfirm={() => {
            setConfirmingProd(false);
            void apply(false);
          }}
        />
      )}
      {confirmingRecreate && (
        <ProdApplyModal
          context={prod.context}
          target={`a new ${name} created from your text`}
          onCancel={() => setConfirmingRecreate(false)}
          onConfirm={() => {
            setConfirmingRecreate(false);
            void recreate();
          }}
        />
      )}
      <div className="yaml-editor">{editor}</div>
    </div>
  );
}
