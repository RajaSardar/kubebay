import { Badge, Card, DataTable, Row, Stack } from "@kubebay/ui";
import type { AttackPath } from "../lib/attackPaths";

/**
 * Intelligence roadmap Tier 3 #24, narrow v1: findings joined into chains
 * that start where outside traffic lands. Read-only.
 */
export function AttackPathsCard({ paths, trivyInstalled }: { paths: AttackPath[]; trivyInstalled: boolean }) {
  const full = paths.filter((p) => p.complete).length;
  return (
    <Card>
      <Stack gap={3}>
        <Row align="center" gap={2} wrap>
          <strong>Attack paths</strong>
          <Badge>read-only</Badge>
          {paths.length > 0 && (
            <span className="small">
              {`${paths.length} path${paths.length === 1 ? "" : "s"} start${paths.length === 1 ? "s" : ""} outside the cluster; ${full} reach${full === 1 ? "es" : ""} both a vulnerable image and a payoff.`}
            </span>
          )}
        </Row>
        <div className="muted small">
          Each row starts at a LoadBalancer or NodePort Service, an Ingress or a Gateway API HTTPRoute, then checks
          whether NetworkPolicy keeps that traffic out, critical and high CVEs in the pods&apos; images (the foothold),
          and the payoff: containers that can break out to the node, RBAC findings for the mounted ServiceAccount
          token, and the Secrets the token can read. Exposure alone isn&apos;t listed.
          {!trivyInstalled && " Trivy Operator isn't installed, so image CVEs are left out of these chains."}
        </div>
        <DataTable
          wrap={false}
          rows={paths}
          rowKey={(p) => `${p.workload.ns}/${p.workload.kind}/${p.workload.name}/${p.serviceAccount}`}
          empty={<div className="muted small">No workload reachable from outside the cluster has a vulnerable image or a payoff.</div>}
          columns={[
            { key: "workload", header: "Workload", className: "mono small", render: (p) => `${p.workload.kind} ${p.workload.ns}/${p.workload.name}` },
            {
              key: "verdict",
              header: "Chain",
              render: (p) => <Badge tone={p.complete ? "err" : "warn"}>{p.complete ? "full chain" : "partial"}</Badge>,
            },
            {
              key: "steps",
              header: "Path",
              className: "small",
              render: (p) => (
                <Stack gap={1}>
                  {p.steps.map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </Stack>
              ),
            },
          ]}
        />
      </Stack>
    </Card>
  );
}
