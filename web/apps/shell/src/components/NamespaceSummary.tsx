import { useNavigate } from "react-router-dom";
import { Badge, Row, Stack } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";

const RESOURCE_ROWS: { label: string; gvr: string; slug: string; testId: string }[] = [
  { label: "Pods", gvr: "v1/pods", slug: "pods", testId: "pods" },
  { label: "Deployments", gvr: "apps/v1/deployments", slug: "deployments", testId: "deployments" },
  { label: "StatefulSets", gvr: "apps/v1/statefulsets", slug: "statefulsets", testId: "statefulsets" },
  { label: "Services", gvr: "v1/services", slug: "services", testId: "services" },
  { label: "ConfigMaps", gvr: "v1/configmaps", slug: "configmaps", testId: "configmaps" },
  { label: "Secrets", gvr: "v1/secrets", slug: "secrets", testId: "secrets" },
];

function ResourceRow({
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
  const count = stream.rows.length;

  const extra =
    gvr === "v1/pods"
      ? (() => {
          const running = stream.rows.filter(
            (r) => (r as Record<string, unknown> & { status?: { phase?: string } })?.status?.phase === "Running",
          ).length;
          return running > 0 && running < count ? `${running} running` : null;
        })()
      : null;

  return (
    <Row
      align="center"
      gap={3}
      data-testid={`row-${testId}`}
      className="cell-link"
      style={{ padding: "8px 0", borderBottom: "1px solid var(--kb-border-subtle)", cursor: "pointer" }}
      onClick={() => navigate(`/r/${slug}?ns=${encodeURIComponent(namespace)}`)}
    >
      <span style={{ flex: 1, fontSize: "var(--kb-text-sm)" }}>{label}</span>
      <Row align="center" gap={2}>
        {extra && <span className="muted small">{extra}</span>}
        <span data-testid={`count-${testId}`}><Badge>{count}</Badge></span>
      </Row>
    </Row>
  );
}

export function NamespaceSummary({ cluster, namespace }: { cluster: string; namespace: string }) {
  return (
    <div style={{ padding: "14px 16px", overflowY: "auto", flex: 1 }}>
      <div className="pod-section-title" style={{ marginBottom: 8 }}>Resources in {namespace}</div>
      <Stack gap={0}>
        {RESOURCE_ROWS.map((r) => (
          <ResourceRow key={r.gvr} cluster={cluster} namespace={namespace} {...r} />
        ))}
      </Stack>
    </div>
  );
}
