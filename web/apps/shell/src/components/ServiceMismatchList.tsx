import { Badge, Card, EmptyState, NsPill, Row, Stack } from "@kubebay/ui";
import { ResourceLink } from "./ResourceLink";
import type { ServiceMismatchFinding } from "../lib/serviceSelectorMismatch";

const REASON_LABEL: Record<ServiceMismatchFinding["reason"], string> = {
  "no-matching-pods": "Selector matches no pods",
  "zero-ready-endpoints": "Zero ready endpoints",
};

/**
 * Backlog #27: pure-rendering half of the Service/Endpoints selector-mismatch
 * detector. A Service is a real, linkable resource (unlike #25's apiVersion
 * findings), so each row links to it via ResourceLink -- same convention
 * #24's SpofRadarList established.
 */
export function ServiceMismatchList({ findings }: { findings: ServiceMismatchFinding[] }) {
  if (findings.length === 0) {
    return (
      <EmptyState>
        <p>Every Service has healthy endpoints.</p>
      </EmptyState>
    );
  }

  return (
    <Stack as="ul" gap={2} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {findings.map((f) => (
        <li key={`${f.namespace}/${f.serviceName}`}>
          <Card>
            <Row align="center" gap={2} wrap>
              <Badge tone="err">{REASON_LABEL[f.reason]}</Badge>
              <NsPill>{f.namespace}</NsPill>
              <ResourceLink kind="services" ns={f.namespace} name={f.serviceName}>
                <span className="mono strong small">{f.serviceName}</span>
              </ResourceLink>
            </Row>
          </Card>
        </li>
      ))}
    </Stack>
  );
}
