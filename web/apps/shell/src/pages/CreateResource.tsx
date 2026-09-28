import { useState } from "react";
import Editor from "@monaco-editor/react";
import { Button, InlineBanner, Row, Select, Stack } from "@kubebay/ui";
import { api } from "../lib/api";
import { useMonacoTheme } from "../lib/theme";
import { RESOURCE_TEMPLATES } from "../lib/resourceTemplates";
import { useActiveCluster } from "../App";
import { PolicyRejectionError, type PolicyRejectionDetail } from "../lib/policyRejection";
import { PolicyRejectionCard } from "../components/PolicyRejectionCard";

export default function CreateResource() {
  const { active } = useActiveCluster();
  const monacoTheme = useMonacoTheme();

  const [selectedKind, setSelectedKind] = useState(RESOURCE_TEMPLATES[0]!.kind);
  const [yaml, setYaml] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [rejection, setRejection] = useState<PolicyRejectionDetail | null>(null);

  const template = RESOURCE_TEMPLATES.find((t) => t.kind === selectedKind) ?? RESOURCE_TEMPLATES[0]!;
  const effectiveYaml = yaml ?? template.yaml;

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
        <span className="mono strong" style={{ fontSize: 13 }}>Create Resource</span>
        <Select
          value={selectedKind}
          onChange={(e) => onKindChange(e.target.value)}
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
        <Row align="center" gap={2} as="label" style={{ fontSize: 12, color: "var(--kb-text-muted)" }}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          Dry run
        </Row>
        <Button
          disabled={applying || !active}
          onClick={() => void apply()}
        >
          {applying ? "Applying…" : dryRun ? "Dry run" : "Apply"}
        </Button>
      </div>

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
