import { Badge, Card, EmptyState, Row, Stack } from "@kubebay/ui";
import { ResourceLink } from "./ResourceLink";
import { slugForKind } from "../lib/resources";
import type { PdbDrainFinding } from "../lib/upgradePdb";
import type { SkewFinding } from "../lib/upgradeSkew";
import type { WebhookFinding } from "../lib/upgradeWebhooks";

/**
 * Backlog #80: the upgrade-impact half of Upgrade Readiness. Pure rendering;
 * a section's findings are undefined when its streams can't be read (RBAC or
 * still loading), which is shown rather than reported as clear.
 */
function Section<T>({ title, findings, clear, children }: { title: string; findings: T[] | undefined; clear: string; children: (f: T, i: number) => React.ReactNode }) {
  return (
    <Stack gap={2}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      {findings === undefined ? (
        <EmptyState><p>This check couldn't be read with your access, or is still loading.</p></EmptyState>
      ) : findings.length === 0 ? (
        <EmptyState><p>{clear}</p></EmptyState>
      ) : (
        <Stack gap={2}>{findings.map(children)}</Stack>
      )}
    </Stack>
  );
}

const WEBHOOK_LABEL: Record<WebhookFinding["kind"], string> = {
  "no-ready-endpoints": "No ready endpoints",
  "matches-kube-system": "Matches kube-system",
  "no-self-exclusion": "Guards itself",
  "high-timeout": "High timeout",
};

export function UpgradeImpactPanel({ pdbs, skew, webhooks }: { pdbs: PdbDrainFinding[] | undefined; skew: SkewFinding[] | undefined; webhooks: WebhookFinding[] | undefined }) {
  return (
    <Stack gap={4}>
      <Section title="Drain blockers (PodDisruptionBudgets)" findings={pdbs} clear="No PDB would block a drain.">
        {(f) => (
          <Card key={`${f.ns}/${f.name}`}>
            <Row align="center" gap={2} wrap>
              <Badge tone="err">{f.reason === "single-replica" ? "Single replica" : "0 disruptions allowed"}</Badge>
              <ResourceLink kind="poddisruptionbudgets" ns={f.ns} name={f.name}>
                <span className="mono strong small">{f.name}</span>
              </ResourceLink>
              <span className="muted small">{f.ns}</span>
            </Row>
            <div className="small" style={{ marginTop: 8 }}>{f.detail}</div>
            <div className="small" style={{ marginTop: 4 }}>
              Blocks draining: <span className="mono">{f.nodes.join(", ") || "unknown nodes"}</span>
            </div>
            {f.workloads.length > 0 && (
              <Row gap={2} wrap style={{ marginTop: 4 }}>
                <span className="small">Protects:</span>
                {f.workloads.map((w) => {
                  const slug = slugForKind(w.kind);
                  return slug ? (
                    <ResourceLink key={`${w.kind}/${w.name}`} kind={slug} ns={f.ns} name={w.name} />
                  ) : (
                    <span key={`${w.kind}/${w.name}`} className="mono small">{w.name}</span>
                  );
                })}
              </Row>
            )}
            <div className="small muted" style={{ marginTop: 4 }}>{f.suggestion}</div>
          </Card>
        )}
      </Section>

      <Section title="Version skew" findings={skew} clear="Node versions are within the skew policy.">
        {(f, i) => (
          <Card key={`${f.kind}/${f.node ?? ""}/${i}`}>
            <Row align="center" gap={2} wrap>
              <Badge tone={f.kind === "mixed-minors" ? "warn" : "err"}>{f.afterTarget ? "After upgrade" : f.kind === "mixed-minors" ? "Mixed minors" : "Out of policy"}</Badge>
              {f.node && <ResourceLink kind="nodes" name={f.node}><span className="mono strong small">{f.node}</span></ResourceLink>}
            </Row>
            <div className="small" style={{ marginTop: 8 }}>{f.detail}</div>
            <div className="small muted" style={{ marginTop: 4 }}>{f.why}</div>
          </Card>
        )}
      </Section>

      <Section title="Admission webhooks" findings={webhooks} clear="No admission webhook looks risky for an upgrade.">
        {(f, i) => (
          <Card key={`${f.config}/${f.webhook}/${f.kind}/${i}`}>
            <Row align="center" gap={2} wrap>
              <Badge tone={f.kind === "high-timeout" ? "warn" : "err"}>{WEBHOOK_LABEL[f.kind]}</Badge>
              <ResourceLink kind={slugForKind(f.configKind) ?? ""} name={f.config}>
                <span className="mono strong small">{f.config}</span>
              </ResourceLink>
              <span className="mono muted small">{f.webhook}</span>
              <span className="muted small">failurePolicy {f.failurePolicy}</span>
            </Row>
            <div className="small" style={{ marginTop: 8 }}>{f.detail}</div>
            <div className="small muted" style={{ marginTop: 4 }}>{f.why}</div>
          </Card>
        )}
      </Section>
    </Stack>
  );
}
