import { useState } from "react";
import Editor from "@monaco-editor/react";
import { Button } from "@kubebay/ui";
import { api } from "../lib/api";
import { useMonacoTheme } from "../lib/theme";
import { RESOURCE_TEMPLATES } from "../lib/resourceTemplates";
import { useActiveCluster } from "../App";

export default function CreateResource() {
  const { active } = useActiveCluster();
  const monacoTheme = useMonacoTheme();

  const [selectedKind, setSelectedKind] = useState(RESOURCE_TEMPLATES[0]!.kind);
  const [yaml, setYaml] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const template = RESOURCE_TEMPLATES.find((t) => t.kind === selectedKind) ?? RESOURCE_TEMPLATES[0]!;
  const effectiveYaml = yaml ?? template.yaml;

  function onKindChange(kind: string) {
    setSelectedKind(kind);
    setYaml(null); // reset to template when kind changes
    setResult(null);
  }

  async function apply() {
    if (!active) return;
    setApplying(true);
    setResult(null);
    try {
      const res = await api.createResource({ cluster: active, yaml: effectiveYaml, dryRun });
      const count = res.total > 1 ? `${res.applied}/${res.total} documents` : "Resource";
      setResult({ ok: true, msg: dryRun ? `Dry-run passed — ${count} validated.` : `${count} applied successfully.` });
      void res;
    } catch (e) {
      setResult({ ok: false, msg: String(e instanceof Error ? e.message : e) });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%" }}>
      <div className="toolbar">
        <span className="mono strong" style={{ fontSize: 13 }}>Create Resource</span>
        <select
          className="toolbar-select"
          value={selectedKind}
          onChange={(e) => onKindChange(e.target.value)}
          aria-label="resource kind"
        >
          {RESOURCE_TEMPLATES.map((t) => (
            <option key={t.kind} value={t.kind}>
              {t.kind}
            </option>
          ))}
        </select>
        <span className="muted small">{template.apiVersion}</span>
        <div style={{ marginLeft: "auto" }} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--kb-text-muted)" }}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          Dry run
        </label>
        <Button
          disabled={applying || !active}
          onClick={() => void apply()}
        >
          {applying ? "Applying…" : dryRun ? "Dry run" : "Apply"}
        </Button>
      </div>

      {result && (
        <div className={result.ok ? "info-banner" : "error-banner"} style={{ margin: "0 0 8px" }}>
          {result.msg}
        </div>
      )}

      {!active && (
        <div className="error-banner" style={{ margin: "0 0 8px" }}>
          No cluster selected.
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          value={effectiveYaml}
          onChange={(v) => { setYaml(v ?? ""); setResult(null); }}
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
    </div>
  );
}
