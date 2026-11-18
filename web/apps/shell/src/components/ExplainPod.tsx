import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button, InlineBanner, Row, Stack } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";
import { explainPod, type ExplainAction, type PodEvent } from "../lib/explainPod";

export type ExplainTab = "logs" | "events" | "yaml";

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function ts(e: Record<string, unknown>): string {
  return String(e.lastTimestamp ?? e.eventTime ?? rec(e.metadata).creationTimestamp ?? "");
}

/**
 * "Explain this pod": a short plain-language diagnosis for a pod that is not healthy, read from the
 * pod's own status and its streamed events. Deterministic, no AI, no network beyond the event stream
 * the pod's Events tab already uses. Renders nothing for a healthy pod.
 */
export function ExplainPod({
  obj,
  cluster,
  onOpenTab,
}: {
  obj: Record<string, unknown>;
  cluster: string;
  onOpenTab: (tab: ExplainTab, opts?: { container?: string; previous?: boolean }) => void;
}) {
  const navigate = useNavigate();
  const meta = rec(obj.metadata);
  const name = String(meta.name ?? "");
  const namespace = String(meta.namespace ?? "");

  // Only stream events for a pod that looks unhealthy on its own; healthy pods cost nothing.
  const suspect = useMemo(() => explainPod(obj, []) !== null, [obj]);
  const stream = useResourceStream(cluster, "v1/events", { mode: "full", ns: namespace ? [namespace] : undefined, enabled: suspect });

  const events = useMemo<PodEvent[]>(() => {
    if (!suspect) return [];
    return stream.rows
      .map((r) => rec(r))
      .filter((r) => {
        const o = rec(r.involvedObject);
        return o.kind === "Pod" && o.name === name && (!namespace || o.namespace === namespace);
      })
      .sort((a, b) => ts(b).localeCompare(ts(a)))
      .map((r) => ({ type: String(r.type ?? ""), reason: String(r.reason ?? ""), message: String(r.message ?? "") }));
  }, [stream.rows, suspect, name, namespace]);

  const explanation = useMemo(() => explainPod(obj, events), [obj, events]);
  if (!explanation) return null;

  function run(a: ExplainAction) {
    if (a.kind === "logs") onOpenTab("logs", { container: a.container, previous: a.previous });
    else if (a.kind === "events") onOpenTab("events");
    else if (a.kind === "yaml") onOpenTab("yaml");
    else navigate(`/detail/${a.resource}/${a.ns || "_"}/${a.name}`);
  }

  return (
    <InlineBanner tone="warn" flush role="region" aria-label="Explain this pod" style={{ marginBottom: 14, display: "block" }}>
      <Stack gap={2}>
        <strong>Why this pod is not healthy</strong>
        <span>{explanation.diagnosis}</span>
        <span className="muted small">Read from {explanation.cites}.</span>
        <Row gap={2} wrap>
          {explanation.steps.map((st, i) => (
            <Button key={i} size="sm" variant="ghost" onClick={() => run(st.action)}>
              {st.label}
            </Button>
          ))}
        </Row>
      </Stack>
    </InlineBanner>
  );
}
