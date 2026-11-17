import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Editor from "../lib/monaco";
import { Button, InlineBanner, Row, Select, Stack } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { api } from "../lib/api";
import { useMonacoTheme } from "../lib/theme";
import { RESOURCE_TEMPLATES } from "../lib/resourceTemplates";
import { useActiveCluster } from "../App";
import { PolicyRejectionError, type PolicyRejectionDetail } from "../lib/policyRejection";
import { PolicyRejectionCard } from "../components/PolicyRejectionCard";
import { DiscardChangesModal, useDiscardGuard } from "../components/DiscardGuard";
import { ProdApplyModal } from "../components/ProdApplyModal";
import { setEditDirty } from "../lib/editGuard";
import { useClusterLooksProduction } from "../lib/useClusterLooksProduction";

export default function CreateResource() {
  const { active } = useActiveCluster();
  const monacoTheme = useMonacoTheme();
  // A table's "+" button opens this page on its own kind: /create-resource?kind=Deployment.
  const [sp] = useSearchParams();
  const requested = sp.get("kind");

  const [selectedKind, setSelectedKind] = useState(
    RESOURCE_TEMPLATES.find((t) => t.kind === requested)?.kind ?? RESOURCE_TEMPLATES[0]!.kind,
  );
  const [yaml, setYaml] = useState<string | null>(null);
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
    setEditDirty("create-resource", dirty);
    return () => setEditDirty("create-resource", false);
  }, [dirty]);
  const { guard, modal } = useDiscardGuard();
  const navigate = useNavigate();
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
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
  }, [dirty]);
  const prod = useClusterLooksProduction(active ?? "");
  const [confirmingProd, setConfirmingProd] = useState(false);

  function onKindChange(kind: string) {
    setSelectedKind(kind);
    setYaml(null); // reset to template when kind changes
    setResult(null);
    setRejection(null);
  }

  async function apply() {
    if (!active) return;
    setApplying(true);
    setResult(null);
    setRejection(null);
    try {
      const res = await api.createResource({ cluster: active, yaml: effectiveYaml, dryRun });
      const count = res.total > 1 ? `${res.applied}/${res.total} documents` : "Resource";
      setResult({ ok: true, msg: dryRun ? `Dry-run passed — ${count} validated.` : `${count} applied successfully.` });
      void res;
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

  return (
    <Stack gap={0} className="page" style={{ height: "100%" }}>
      <div className="toolbar">
        <span className="mono strong" style={{ fontSize: "var(--kb-text-md)" }}>Create Resource</span>
        <PageHelp route="/create-resource" />
        <Select
          value={selectedKind}
          onChange={guard((e: React.ChangeEvent<HTMLSelectElement>) => onKindChange(e.target.value))}
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
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          Dry run
        </Row>
        <Button
          disabled={applying || !active}
          onClick={() => (prod.production && !dryRun ? setConfirmingProd(true) : void apply())}
        >
          {applying ? "Applying…" : dryRun ? "Dry run" : "Apply"}
        </Button>
      </div>

      {modal}
      {leaveTo !== null && (
        <DiscardChangesModal
          onKeep={() => setLeaveTo(null)}
          onDiscard={() => {
            const to = leaveTo;
            setLeaveTo(null);
            setEditDirty("create-resource", false);
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

      {!active && (
        <InlineBanner flush style={{ margin: "0 0 8px" }}>
          No cluster selected.
        </InlineBanner>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          value={effectiveYaml}
          onChange={(v) => { setYaml(v ?? ""); setResult(null); setRejection(null); }}
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
