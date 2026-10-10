import { useState } from "react";
import { Badge, Button, InlineBanner, Row, Spinner, Stack } from "@kubebay/ui";
import { triageApi, type TriagePreview } from "../lib/api";

const preStyle = {
  fontSize: "var(--kb-text-xs)",
  whiteSpace: "pre-wrap" as const,
  overflowWrap: "anywhere" as const,
  background: "var(--kb-bg-inset)",
  padding: 8,
  borderRadius: "var(--kb-radius-xs)",
  margin: 0,
  maxHeight: 260,
  overflow: "auto",
};

/**
 * Backlog #13, slice 1: the review pane. It gathers one pod's evidence
 * bundle on request and shows the exact request a Send would make. Nothing
 * is sent from here yet; the bundle can be copied into any assistant.
 */
export function TriageTab({ cluster, namespace, pod }: { cluster: string; namespace: string; pod: string }) {
  const [preview, setPreview] = useState<TriagePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const gather = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await triageApi.preview({ cluster, namespace, pod }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = () => {
    const text = preview?.request.messages[0]?.content ?? "";
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <div style={{ padding: 14 }}>
      <Stack gap={3}>
        <div className="muted small">
          Gathers this pod&apos;s evidence: the pod and its owners, container states, warnings, recent rollouts and logs,
          with a restarted container&apos;s previous run first and credentials masked. You see all of it before anything
          leaves Kubebay.
        </div>
        <Row gap={2} align="center">
          <Button disabled={busy} onClick={() => void gather()}>
            {preview ? "Gather again" : "Gather evidence"}
          </Button>
          {busy && <Spinner label="Gathering evidence…" size={16} />}
        </Row>
        {error && <InlineBanner flush>{error}</InlineBanner>}
        {preview && (
          <Stack gap={3}>
            <Stack gap={1}>
              <div className="strong small">What would be sent</div>
              <Row gap={2} align="center" wrap>
                <span className="muted small">To</span>
                <span className="mono small">{preview.endpoint}</span>
                <span className="muted small">model</span>
                <span className="mono small">{preview.request.model}</span>
              </Row>
              <Row gap={2} align="center" wrap>
                <Badge>about {preview.approxTokens} tokens</Badge>
                <Badge tone={preview.evidence.masked > 0 ? "info" : undefined}>{preview.evidence.masked} values masked</Badge>
                {preview.evidence.truncated && <Badge tone="warn">logs were cut to fit</Badge>}
              </Row>
            </Stack>
            <InlineBanner tone="warn" flush>
              Nothing has been sent. Kubebay doesn&apos;t call the model yet; copy the evidence into the assistant you use.
            </InlineBanner>
            <Row gap={2}>
              <Button variant="ghost" onClick={copy}>
                {copied ? "Copied" : "Copy evidence"}
              </Button>
            </Row>
            {preview.evidence.sections.map((s) => (
              <Stack key={s.id} gap={1}>
                <Row gap={2} align="center">
                  <span className="mono small muted">{s.id}</span>
                  <span className="strong small">{s.title}</span>
                </Row>
                <pre className="mono" style={preStyle}>
                  {s.text}
                </pre>
              </Stack>
            ))}
            <details>
              <summary className="small strong" style={{ cursor: "pointer" }}>
                Instructions sent with it
              </summary>
              <pre className="mono" style={{ ...preStyle, marginTop: 6 }}>
                {preview.request.system}
              </pre>
            </details>
          </Stack>
        )}
      </Stack>
    </div>
  );
}
