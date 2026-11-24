import { useMemo } from "react";
import { Badge, Row, Stack, StatusDot } from "@kubebay/ui";
import { ResourceLink } from "./ResourceLink";
import { useResourceStream } from "../lib/useResourceStream";
import { summarizeEndpoints } from "../lib/serviceEndpoints";

const SLUG_OF_KIND: Record<string, string> = { Pod: "pods", Node: "nodes" };

/** A Service's endpoints: each address with its readiness and target pod, and the ports they serve. */
export function ServiceEndpoints({ cluster, namespace, name }: { cluster: string; namespace: string; name: string }) {
  const { rows } = useResourceStream(cluster, "discovery.k8s.io/v1/endpointslices", {
    ns: [namespace],
    labelSelector: `kubernetes.io/service-name=${name}`,
    mode: "full",
  });
  const s = useMemo(() => summarizeEndpoints(rows), [rows]);
  const title = s.notReady > 0 ? `Endpoints (${s.ready} ready, ${s.notReady} not ready)` : s.ready > 0 ? `Endpoints (${s.ready} ready)` : "Endpoints (0)";

  return (
    <div className="pod-section">
      <div className="pod-section-title">{title}</div>
      {s.endpoints.length === 0 ? (
        <span className="muted small">No endpoints: no ready pod matches this Service's selector.</span>
      ) : (
        <Stack gap={1}>
          {s.ports.length > 0 && (
            <Row gap={1} wrap>
              {s.ports.map((p) => (
                <Badge key={`${p.name}/${p.port}/${p.protocol}`}>{`${p.name ? p.name + " " : ""}${p.port}/${p.protocol}`}</Badge>
              ))}
            </Row>
          )}
          {s.endpoints.map((e, i) => (
            <Row key={`${e.address}-${i}`} gap={2} align="center" wrap>
              <StatusDot status={e.ready ? "connected" : "unreachable"} />
              <span className="mono small">{e.address}</span>
              <span className="small">{e.ready ? "Ready" : "Not ready"}</span>
              {e.target && SLUG_OF_KIND[e.target.kind] ? (
                <ResourceLink kind={SLUG_OF_KIND[e.target.kind]!} ns={e.target.ns} name={e.target.name}>
                  <span className="mono small">{e.target.name}</span>
                </ResourceLink>
              ) : e.target ? (
                <span className="mono small muted">{`${e.target.kind}/${e.target.name}`}</span>
              ) : null}
              {e.node && <span className="muted small mono">{e.node}</span>}
            </Row>
          ))}
        </Stack>
      )}
    </div>
  );
}
