import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Editor from "../lib/monaco";
import { Button, InlineBanner, Row, Select, Stack } from "@kubebay/ui";
import { PageHelp } from "./PageHelp";
import { api } from "../lib/api";
import { useMonacoTheme } from "../lib/theme";
import { RESOURCE_TEMPLATES } from "../lib/resourceTemplates";
import { PolicyRejectionError, type PolicyRejectionDetail } from "../lib/policyRejection";
import { PolicyRejectionCard } from "./PolicyRejectionCard";
import { DiscardChangesModal } from "./DiscardGuard";
import { ProdApplyModal } from "./ProdApplyModal";
import { setEditDirty } from "../lib/editGuard";
import { useClusterLooksProduction } from "../lib/useClusterLooksProduction";
import { useTerminalDock } from "../lib/terminalDock";

/**
 * Create Resource: a kind picker with templates over a YAML editor. It is the
 * body of the Create Resource page (variant "page") and of the dock's "New
 * resource" tab (variant "dock", backlog 51 phase 4), so both behave alike.
 */
export function NewResourceEditor({
  cluster,
  guardKey,
  variant,
  initialKind,
  initialYaml,
}: {
  cluster: string | null;
  /** The key this editor reports to the unsaved-edit guard under. */
  guardKey: string;
  variant: "page" | "dock";
  initialKind?: string;
  /** Text to start from instead of the kind's template (carried over from the page). */
  initialYaml?: string;
}) {
  const monacoTheme = useMonacoTheme();
  const [selectedKind, setSelectedKind] = useState(
    RESOURCE_TEMPLATES.find((t) => t.kind === initialKind)?.kind ?? RESOURCE_TEMPLATES[0]!.kind,
  );
  const [yaml, setYaml] = useState<string | null>(initialYaml ?? null);
  const [applying, setApplying] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [rejection, setRejection] = useState<PolicyRejectionDetail | null>(null);

  const template = RESOURCE_TEMPLATES.find((t) => t.kind === selectedKind) ?? RESOURCE_TEMPLATES[0]!;
  const effectiveYaml = yaml ?? template.yaml;

  // An edit that was not applied: protect it from a kind switch (which resets to the template),
  // an in-app link, and closing the window.
  const dirty = yaml !== null && yaml !== template.yaml;
  useEffect(() => {
    setEditDirty(guardKey, dirty);
    return () => setEditDirty(guardKey, false);
  }, [guardKey, dirty]);
  // The dock's text budget counts what this editor holds.
  const reportSize = useTerminalDock((s) => s.reportSize);
  useEffect(() => {
    if (variant === "dock") reportSize(guardKey, effectiveYaml.length);
  }, [variant, guardKey, effectiveYaml, reportSize]);

  // Switching kind resets the text to the new template, so an edit asks first (about this editor only).
  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const navigate = useNavigate();
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty || variant !== "page") return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const href = a?.getAttribute("href");
      if (!a || !href || !href.startsWith("/") || a.target === "_blank") return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(href);
    };
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty, variant]);
  const prod = useClusterLooksProduction(cluster ?? "");
  const [confirmingProd, setConfirmingProd] = useState(false);

  function onKindChange(kind: string) {
    setSelectedKind(kind);
    setYaml(null); // reset to template when kind changes
    setResult(null);
    setRejection(null);
  }

  async function apply() {
    if (!cluster) return;
    setApplying(true);
    setResult(null);
    setRejection(null);
    try {
      const res = await api.createResource({ cluster, yaml: effectiveYaml, dryRun });
      const count = res.total > 1 ? `${res.applied}/${res.total} documents` : "Resource";
      setResult({ ok: true, msg: dryRun ? `Dry-run passed — ${count} validated.` : `${count} applied successfully.` });
    } catch (e) {
      if (e instanceof PolicyRejectionError) {
        setRejection(e.rejection);
      } else {
        setResult({ ok: false, msg: String(e instanceof Error ? e.message : e) });
      }
    } finally {
      setApplying(false);
    }
  }

  // Move this editor into a dock tab, text and all, and leave the page on a fresh template.
  function openInDock() {
    useTerminalDock.getState().openNewTab({ kind: selectedKind, yaml: dirty ? effectiveYaml : undefined });
    onKindChange(selectedKind);
  }

  return (
    <Stack gap={0} className="page" style={{ height: "100%" }}>
      <div className="toolbar">
        {variant === "page" && (
          <>
            <span className="mono strong" style={{ fontSize: "var(--kb-text-md)" }}>Create Resource</span>
            <PageHelp route="/create-resource" />
          </>
        )}
        <Select
          value={selectedKind}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            dirty ? setPendingKind(e.target.value) : onKindChange(e.target.value)
          }
          aria-label="resource kind"
        >
          {RESOURCE_TEMPLATES.map((t) => (
            <option key={t.kind} value={t.kind}>
              {t.kind}
            </option>
          ))}
        </Select>
        <span className="muted small">{template.apiVersion}</span>
        <div style={{ marginLeft: "auto" }} />
        <Row align="center" gap={2} as="label" style={{ fontSize: "var(--kb-text-sm)", color: "var(--kb-fg-muted)" }}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          Dry run
        </Row>
        {variant === "page" && (
          <Button variant="ghost" onClick={openInDock}>
            Open in dock
          </Button>
        )}
        <Button
          disabled={applying || !cluster}
          onClick={() => (prod.production && !dryRun ? setConfirmingProd(true) : void apply())}
        >
          {applying ? "Applying…" : dryRun ? "Dry run" : "Apply"}
        </Button>
      </div>

      {pendingKind !== null && (
        <DiscardChangesModal
          keys={[guardKey]}
          onKeep={() => setPendingKind(null)}
          onDiscard={() => {
            onKindChange(pendingKind);
            setPendingKind(null);
          }}
        />
      )}
      {leaveTo !== null && (
        <DiscardChangesModal
          onKeep={() => setLeaveTo(null)}
          onDiscard={() => {
            const to = leaveTo;
            setLeaveTo(null);
            setEditDirty(guardKey, false);
            navigate(to);
          }}
        />
      )}
      {confirmingProd && (
        <ProdApplyModal
          context={prod.context}
          target="this YAML"
          onCancel={() => setConfirmingProd(false)}
          onConfirm={() => {
            setConfirmingProd(false);
            void apply();
          }}
        />
      )}
      {rejection && (
        <div style={{ margin: "0 0 8px" }}>
          <PolicyRejectionCard rejection={rejection} />
        </div>
      )}
      {!rejection && result && (
        <InlineBanner flush tone={result.ok ? "ok" : "err"} style={{ margin: "0 0 8px" }}>
          {result.msg}
        </InlineBanner>
      )}

      {!cluster && (
        <InlineBanner flush style={{ margin: "0 0 8px" }}>
          No cluster selected.
        </InlineBanner>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          value={effectiveYaml}
          onChange={(v) => {
            setYaml(v ?? "");
            setResult(null);
            setRejection(null);
          }}
          defaultLanguage="yaml"
          theme={monacoTheme}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            automaticLayout: true,
            tabSize: 2,
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </Stack>
  );
}
