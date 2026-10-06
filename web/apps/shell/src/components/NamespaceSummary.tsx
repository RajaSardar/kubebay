import { useNavigate } from "react-router-dom";
import { Badge, Row, Stack, StatusDot } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";

const SECTIONS: { label: string; gvr: string; slug: string; testId: string }[] = [
  { label: "Pods", gvr: "v1/pods", slug: "pods", testId: "pods" },
  { label: "Deployments", gvr: "apps/v1/deployments", slug: "deployments", testId: "deployments" },
  { label: "StatefulSets", gvr: "apps/v1/statefulsets", slug: "statefulsets", testId: "statefulsets" },
  { label: "Services", gvr: "v1/services", slug: "services", testId: "services" },
  { label: "ConfigMaps", gvr: "v1/configmaps", slug: "configmaps", testId: "configmaps" },
  { label: "Secrets", gvr: "v1/secrets", slug: "secrets", testId: "secrets" },
];

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function podDot(row: Record<string, unknown>): "connected" | "degraded" | "unreachable" | "pending" {
  const phase = str(rec(row.status).phase);
  if (phase === "Running") return "connected";
  if (phase === "Succeeded") return "pending";
  if (phase === "Failed") return "unreachable";
  return "degraded";
}

function podTitle(row: Record<string, unknown>): string {
  return str(rec(row.status).phase) || "Unknown";
}

function workloadDot(row: Record<string, unknown>): "connected" | "degraded" {
  const st = rec(row.status);
  const ready = Number(st.readyReplicas ?? 0);
  const desired = Number(st.replicas ?? 1);
  return ready >= desired && desired > 0 ? "connected" : "degraded";
}

function ResourceSection({
  cluster,
  namespace,
  label,
  gvr,
  slug,
  testId,
}: {
  cluster: string;
  namespace: string;
  label: string;
  gvr: string;
  slug: string;
  testId: string;
}) {
  const navigate = useNavigate();
  const stream = useResourceStream(cluster, gvr, { ns: [namespace] });
  const rows = stream.rows;

  if (!rows.length) return null;

  const isPods = gvr === "v1/pods";
  const isWorkload = gvr === "apps/v1/deployments" || gvr === "apps/v1/statefulsets";

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Section header — clickable to navigate to the full resource table */}
      <Row
        align="center"
        gap={2}
        className="cell-link"
        style={{ cursor: "pointer", marginBottom: 4 }}
        onClick={() => navigate(`/r/${slug}?ns=${encodeURIComponent(namespace)}`)}
      >
        <span className="pod-section-title" style={{ margin: 0 }}>{label} ({rows.length})</span>
        {/* hidden span preserves the count testid for tests */}
        <span data-testid={`count-${testId}`} style={{ display: "none" }}>{rows.length}</span>
        <span className="muted small" style={{ marginLeft: "auto" }}>View all →</span>
      </Row>

      {/* Resource rows */}
      <Stack gap={0}>
        {rows.map((row, i) => {
          const name = str(rec(row.metadata).name);
          const dot = isPods ? podDot(row) : isWorkload ? workloadDot(row) : undefined;
          const title = isPods ? podTitle(row) : undefined;

          return (
            <Row
              key={i}
              align="center"
              gap={2}
              style={{ padding: "3px 0", borderBottom: "1px solid var(--kb-border-subtle)" }}
            >
              {dot && <span title={title}><StatusDot status={dot} /></span>}
              <span className="mono small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name}
              </span>
              {isPods && (
                <span className="muted small" style={{ flexShrink: 0 }}>
                  {str(rec(row.status).phase)}
                </span>
              )}
              {isWorkload && (() => {
                const ready = Number(rec(row.status).readyReplicas ?? 0);
                const desired = Number(rec(row.status).replicas ?? 0);
                return <span className="muted small" style={{ flexShrink: 0 }}>{ready}/{desired}</span>;
              })()}
              {gvr === "v1/services" && (
                <Badge>{str(rec(row.spec).type) || "ClusterIP"}</Badge>
              )}
            </Row>
          );
        })}
      </Stack>
    </div>
  );
}

export function NamespaceSummary({ cluster, namespace }: { cluster: string; namespace: string }) {
  return (
    <div style={{ padding: "14px 16px", overflowY: "auto", flex: 1 }}>
      <div className="pod-section-title" style={{ marginBottom: 12 }}>Resources in {namespace}</div>
      {SECTIONS.map((s) => (
        <ResourceSection key={s.gvr} cluster={cluster} namespace={namespace} {...s} />
      ))}
    </div>
  );
}
