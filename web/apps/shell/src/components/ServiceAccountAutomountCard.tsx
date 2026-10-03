import { Badge, Card, Row, Stack } from "@kubebay/ui";
import type { AutomountFinding } from "../lib/serviceAccountAutomount";
import { ControlTags } from "./ControlTags";
import { controlsFor } from "../lib/controlIds";

/**
 * Backlog #28: sits alongside RbacFindingsCard as its own Card section --
 * this page already stacks independent security-check cards vertically
 * (Who-can query, RBAC findings, My access) rather than using tabs, so a
 * new unrelated check follows that same established pattern instead of
 * introducing tabs just for this one addition.
 */
export function ServiceAccountAutomountCard({ findings }: { findings: AutomountFinding[] }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <Row align="center" gap={2} className="rbac-section-title">
        Default ServiceAccount token automount
        <Badge tone={findings.length > 0 ? "err" : "ok"}>{findings.length}</Badge>
        <ControlTags controls={controlsFor("default-sa-automount")} />
      </Row>

      {findings.length === 0 ? (
        <div className="muted small" style={{ marginTop: 10 }}>
          No workloads auto-mount the default ServiceAccount token.
        </div>
      ) : (
        <Stack gap={2} style={{ marginTop: 10 }}>
          {findings.map((f) => (
            <div key={`${f.namespace}/${f.appLabel}`} style={{ borderBottom: "1px solid var(--kb-border-subtle)", paddingBottom: 10 }}>
              <Row align="center" gap={2} wrap>
                <span className="mono strong small">{f.namespace}</span>
                <span className="small">{f.appLabel}</span>
                <span className="muted small">{f.podCount} pod{f.podCount === 1 ? "" : "s"}</span>
              </Row>
              <div className="small muted">
                Runs on the default ServiceAccount with its API token still mounted — almost never needed and a live cluster credential a compromised container doesn't have to work for.
              </div>
            </div>
          ))}
        </Stack>
      )}
    </Card>
  );
}
