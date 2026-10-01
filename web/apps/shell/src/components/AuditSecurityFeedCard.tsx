import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, DataTable, InlineBanner, Row, Select, SkeletonLines, Stack, TextField, type BadgeTone } from "@kubebay/ui";
import { securityApi, type AuditSecurityEvent } from "../lib/api";

const TONE: Record<AuditSecurityEvent["severity"], BadgeTone | undefined> = { high: "err", medium: "warn", low: undefined };

/**
 * Intelligence roadmap Tier 3 #26: a retrospective security feed from the
 * cluster's own API server audit log, read from a local file the user points
 * at. No in-cluster agent; the precondition is audit logging already on.
 */
export function AuditSecurityFeedCard({ cluster }: { cluster: string }) {
  const qc = useQueryClient();
  const key = ["audit-security-events", cluster];
  const q = useQuery({ queryKey: key, queryFn: () => securityApi.auditEvents(cluster), enabled: !!cluster, refetchInterval: 30_000 });
  const [draft, setDraft] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [severity, setSeverity] = useState("");

  const data = q.data;
  const events = useMemo(() => (data?.events ?? []).filter((e) => !severity || e.severity === severity), [data, severity]);
  const editing = draft !== null || (data && !data.configured);

  async function savePath(path: string) {
    setBusy(true);
    setSaveError("");
    try {
      await securityApi.setAuditLogPath(cluster, path);
      setDraft(null);
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Stack gap={3}>
        <Row align="center" gap={2} wrap>
          <strong>Audit-log security events</strong>
          <Badge>read-only</Badge>
          {data?.configured && !data.error && (
            <span className="small">{`${data.events.length} event${data.events.length === 1 ? "" : "s"} in the newest part of the log.`}</span>
          )}
        </Row>
        <div className="muted small">
          Exec and attach into pods, privileged or host-namespace pods, hostPath mounts, cluster-admin and other
          ClusterRoleBinding changes, anonymous requests that succeeded, and people reading Secrets. This needs the API
          server&apos;s audit log: audit logging must already be on, with the log file readable on this machine (a kind
          node mount, a kubeadm control plane, or a copy synced from your provider). Privileged-pod and binding details
          need the policy to log at Request level for pods and RBAC objects.
        </div>
        {q.isLoading && <SkeletonLines lines={3} label="Loading audit events…" />}
        {q.error && <InlineBanner tone="warn" flush>{q.error instanceof Error ? q.error.message : String(q.error)}</InlineBanner>}
        {data && editing && (
          <Row gap={2} align="center" wrap>
            <TextField
              aria-label="Audit log path"
              placeholder="/var/log/kubernetes/audit/audit.log"
              value={draft ?? ""}
              onChange={(e) => setDraft(e.target.value)}
              style={{ minWidth: 0, flex: "1 1 280px" }}
            />
            <Button disabled={busy || !(draft ?? "").trim()} onClick={() => void savePath((draft ?? "").trim())}>
              Save path
            </Button>
            {data.configured && (
              <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
                Cancel
              </Button>
            )}
          </Row>
        )}
        {saveError && <InlineBanner flush>{saveError}</InlineBanner>}
        {data?.configured && !editing && (
          <Row gap={2} align="center" wrap>
            <span className="muted small">
              Reading <span className="mono">{data.path}</span>
            </span>
            <Button variant="ghost" onClick={() => setDraft(data.path ?? "")}>
              Change
            </Button>
            <Button variant="danger-ghost" disabled={busy} onClick={() => void savePath("")}>
              Stop reading
            </Button>
            <span style={{ marginLeft: "auto" }}>
              <Select aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="">All severities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </span>
          </Row>
        )}
        {data?.configured && data.error && <InlineBanner flush>{`Couldn't read the audit log: ${data.error}`}</InlineBanner>}
        {data?.configured && !data.error && (
          <DataTable
            wrap={false}
            rows={events}
            rowKey={(e, i) => `${e.id}:${i}`}
            empty={<div className="muted small">No security events in the newest part of the log.</div>}
            columns={[
              { key: "time", header: "Time", className: "mono small", render: (e) => e.time },
              {
                key: "event",
                header: "Event",
                render: (e) => (
                  <Row gap={2} align="center">
                    <Badge tone={TONE[e.severity]}>{e.severity}</Badge>
                    <span>{e.title}</span>
                  </Row>
                ),
              },
              { key: "who", header: "Who", className: "mono small", render: (e) => (e.sourceIP ? `${e.user} (${e.sourceIP})` : e.user) },
              { key: "object", header: "Object", className: "mono small", render: (e) => e.object },
              { key: "detail", header: "Detail", className: "small", render: (e) => e.detail ?? "" },
              {
                key: "outcome",
                header: "Outcome",
                render: (e) => <Badge tone={e.allowed ? undefined : "ok"}>{e.allowed ? "allowed" : "denied"}</Badge>,
              },
            ]}
          />
        )}
      </Stack>
    </Card>
  );
}
