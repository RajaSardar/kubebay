import { Badge, Card, EmptyState, Row, Stack } from "@kubebay/ui";
import type { UpgradeReadinessFinding } from "../lib/upgradeReadiness";

/**
 * Backlog #25: pure-rendering half of the Upgrade Readiness Panel. Unlike
 * SPOF Radar's findings, these aren't tied to one object -- an apiVersion
 * removal is a cluster-wide fact, not a resource to link to -- so this is a
 * plain advisory list, not ResourceLink-backed cards.
 */
export function UpgradeReadinessPanel({ findings, serverVersion }: { findings: UpgradeReadinessFinding[]; serverVersion: string }) {
  if (findings.length === 0) {
    return (
      <EmptyState>
        <p>No soon-to-be-removed API versions detected. This cluster ({serverVersion}) looks upgrade-ready.</p>
      </EmptyState>
    );
  }

  return (
    <Stack as="ul" gap={2} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {findings.map((f) => {
        const overdue = f.minorsAway <= 0;
        return (
          <li key={f.apiVersion}>
            <Card>
              <Row align="center" gap={2} wrap>
                <Badge tone={overdue ? "err" : "warn"}>{overdue ? "Overdue" : `${f.minorsAway} minor${f.minorsAway === 1 ? "" : "s"} away`}</Badge>
                <strong>{f.kind}</strong>
                <span className="mono small">{f.apiVersion}</span>
              </Row>
              <div className="small" style={{ marginTop: 8 }}>
                Removed in v1.{f.removedInMinor} — migrate to <span className="mono">{f.replacementVersion}</span>.
              </div>
            </Card>
          </li>
        );
      })}
    </Stack>
  );
}
