import { Badge, Card, DataTable, NsPill, Row } from "@kubebay/ui";
import type { OrphanedSecret } from "../lib/orphanedSecrets";
import { fmtAge } from "../lib/resources";

/** Roadmap Tier 2 #16: stacked with the other security cards on this page. */
export function OrphanedSecretsCard({ secrets }: { secrets: OrphanedSecret[] }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <Row align="center" gap={2} className="rbac-section-title">
        Unreferenced Secrets
        <Badge tone={secrets.length > 0 ? "warn" : "ok"}>{secrets.length}</Badge>
      </Row>

      {secrets.length === 0 ? (
        <div className="muted small" style={{ marginTop: 10 }}>
          Every Secret is referenced by a pod, workload, ServiceAccount or Ingress.
        </div>
      ) : (
        <>
          <div className="muted small" style={{ margin: "10px 0 8px" }}>
            No pod, workload template, ServiceAccount or Ingress TLS block names these. References from custom resources
            (Gateway certificates, operators) aren't checked, so review before deleting.
          </div>
          <DataTable
            rows={secrets}
            rowKey={(s) => `${s.namespace}/${s.name}`}
            columns={[
              { key: "ns", header: "Namespace", render: (s) => <NsPill>{s.namespace}</NsPill> },
              { key: "name", header: "Secret", className: "mono small strong", render: (s) => s.name },
              {
                key: "age",
                header: "Age",
                className: "mono small",
                render: (s) => (s.createdAt ? fmtAge(Math.max(0, Date.now() - Date.parse(s.createdAt))) : "—"),
              },
            ]}
          />
        </>
      )}
    </Card>
  );
}
