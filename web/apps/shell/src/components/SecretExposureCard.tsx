import { Badge, Card, Row, Stack } from "@kubebay/ui";
import type { SecretExposureFinding } from "../lib/secretExposure";
import { ControlTags } from "./ControlTags";
import { controlsFor } from "../lib/controlIds";

/**
 * Backlog #29: follows the same stacked-Card convention as
 * RbacFindingsCard/ServiceAccountAutomountCard on this page rather than a
 * tab, for the same reason -- an independent security-check card, not
 * another view of the same data.
 */
export function SecretExposureCard({ findings }: { findings: SecretExposureFinding[] }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <Row align="center" gap={2} className="rbac-section-title">
        Secrets exposed via environment variables
        <Badge tone={findings.length > 0 ? "err" : "ok"}>{findings.length}</Badge>
        <ControlTags controls={controlsFor("secret-env")} />
      </Row>

      {findings.length === 0 ? (
        <div className="muted small" style={{ marginTop: 10 }}>
          No workloads expose secrets via environment variables.
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
              <Row gap={1} wrap style={{ marginTop: 4 }}>
                {f.secretNames.map((name) => (
                  <Badge key={name}>{name}</Badge>
                ))}
              </Row>
              <div className="small muted" style={{ marginTop: 4 }}>
                Passed via env/envFrom rather than a mounted volume — more exposed to process dumps, child-process inheritance, and accidental logging.
              </div>
            </div>
          ))}
        </Stack>
      )}
    </Card>
  );
}
