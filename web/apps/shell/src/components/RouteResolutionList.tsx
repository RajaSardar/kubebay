import { Badge, Card, NsPill, Row, Stack } from "@kubebay/ui";
import { isRouteBroken, type RouteIssue, type RouteResolution } from "../lib/routeResolution";

function describeIssue(i: RouteIssue): string {
  switch (i.kind) {
    case "service-missing":
      return `Service ${i.service} not found`;
    case "port-missing":
      return `Service ${i.service} has no port ${i.port}`;
    case "no-ready-endpoints":
      return `Service ${i.service} has no ready endpoints`;
    case "class-missing":
      return `IngressClass ${i.className} not found`;
    case "no-class":
      return "No IngressClass set and no default class";
    case "tls-secret-missing":
      return `TLS Secret ${i.secret} not found`;
    case "gateway-missing":
      return `Gateway ${i.gateway} not found`;
    case "status-condition":
      return `${i.type}: ${i.reason}${i.message ? ` — ${i.message}` : ""}`;
  }
}

/** Roadmap Tier 2 #13: broken Ingress/HTTPRoute routes on the Service Health tab, each hop that fails named. */
export function RouteResolutionList({ routes }: { routes: RouteResolution[] }) {
  const broken = routes.filter(isRouteBroken);
  const healthy = routes.length - broken.length;

  return (
    <Card>
      <Row align="center" gap={2} style={{ marginBottom: 8 }}>
        <strong>Ingress & Gateway routing</strong>
        {routes.length > 0 && <Badge tone={broken.length > 0 ? "err" : "ok"}>{broken.length}</Badge>}
      </Row>

      {routes.length === 0 ? (
        <div className="muted small">No Ingresses or HTTPRoutes in this cluster.</div>
      ) : broken.length === 0 ? (
        <div className="muted small">Every route resolves to a ready backend.</div>
      ) : (
        <Stack gap={3}>
          {broken.map((r) => (
            <Stack key={`${r.routeKind}/${r.namespace}/${r.name}`} gap={1}>
              <Row align="center" gap={2} wrap>
                <Badge>{r.routeKind}</Badge>
                <NsPill>{r.namespace}</NsPill>
                <strong className="mono small">{r.name}</strong>
              </Row>
              {r.issues.map((i) => (
                <Row key={describeIssue(i)} align="center" gap={2}>
                  <Badge tone="err">route</Badge>
                  <span className="small">{describeIssue(i)}</span>
                </Row>
              ))}
              {r.paths
                .filter((p) => p.issues.length > 0)
                .map((p) => (
                  <Row key={`${p.host}${p.path}${p.backend}`} align="center" gap={2} wrap>
                    <span className="mono small muted">
                      {p.host}
                      {p.path} → {p.backend}
                    </span>
                    {p.issues.map((i) => (
                      <span key={describeIssue(i)} className="small">
                        {describeIssue(i)}
                      </span>
                    ))}
                  </Row>
                ))}
            </Stack>
          ))}
          {healthy > 0 && (
            <div className="muted small">
              {healthy} route{healthy === 1 ? " resolves" : "s resolve"} cleanly.
            </div>
          )}
        </Stack>
      )}
    </Card>
  );
}
