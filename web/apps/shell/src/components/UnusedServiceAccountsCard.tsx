import { Badge, Card, DataTable, NsPill, Row, Stack } from "@kubebay/ui";
import type { UnusedServiceAccount } from "../lib/unusedServiceAccounts";
import { fmtAge } from "../lib/resources";

/** Backlog #13's deferred check: stacked with the other security cards on this page. */
export function UnusedServiceAccountsCard({ accounts }: { accounts: UnusedServiceAccount[] }) {
  const withPermissions = accounts.filter((a) => a.bindings.length > 0).length;
  return (
    <Card style={{ marginBottom: 16 }}>
      <Row align="center" gap={2} className="rbac-section-title">
        Unused ServiceAccounts
        <Badge tone={accounts.length > 0 ? "warn" : "ok"}>{accounts.length}</Badge>
        {withPermissions > 0 && <Badge tone="warn">{`${withPermissions} with permissions`}</Badge>}
      </Row>

      {accounts.length === 0 ? (
        <div className="muted small" style={{ marginTop: 10 }}>
          Every ServiceAccount is used by a pod or workload in its namespace.
        </div>
      ) : (
        <>
          <div className="muted small" style={{ margin: "10px 0 8px" }}>
            No pod or workload template (Deployment, StatefulSet, DaemonSet, CronJob) runs as these. Ones that bindings
            grant permissions to are listed first. A ServiceAccount can still be used from outside the cluster with a
            token (a CI job, a kubeconfig), which Kubebay can&apos;t see; a long-lived token Secret is a sign of that.
            Review before deleting.
          </div>
          <DataTable
            rows={accounts}
            rowKey={(a) => `${a.namespace}/${a.name}`}
            columns={[
              { key: "ns", header: "Namespace", render: (a) => <NsPill>{a.namespace}</NsPill> },
              { key: "name", header: "ServiceAccount", className: "mono small strong", render: (a) => a.name },
              {
                key: "bindings",
                header: "Granted by",
                className: "mono small",
                render: (a) =>
                  a.bindings.length === 0 ? (
                    <span className="muted">no bindings</span>
                  ) : (
                    <Stack gap={1}>
                      {a.bindings.map((b) => (
                        <span key={b}>{b}</span>
                      ))}
                    </Stack>
                  ),
              },
              {
                key: "tokens",
                header: "Long-lived token",
                className: "mono small",
                render: (a) =>
                  a.tokenSecrets.length === 0 ? (
                    "—"
                  ) : (
                    <Stack gap={1}>
                      {a.tokenSecrets.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </Stack>
                  ),
              },
              {
                key: "age",
                header: "Age",
                className: "mono small",
                render: (a) => (a.createdAt ? fmtAge(Math.max(0, Date.now() - Date.parse(a.createdAt))) : "—"),
              },
            ]}
          />
        </>
      )}
    </Card>
  );
}
