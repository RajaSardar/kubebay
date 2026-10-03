import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge, Button, Card, DataTable, InlineBanner, Row, Select, SkeletonLines, Stack, TextField, type BadgeTone } from "@kubebay/ui";
import { securityApi, type AuditCloudSource, type AuditEventsResponse, type AuditSecurityEvent } from "../lib/api";
import { auditObjectHref } from "../lib/auditLinks";

const TONE: Record<AuditSecurityEvent["severity"], BadgeTone | undefined> = { high: "err", medium: "warn", low: undefined };

type SourceKind = "file" | "eks" | "gke";

interface Draft {
  kind: SourceKind;
  path: string;
  cluster: string;
  region: string;
  profile: string;
  project: string;
  location: string;
}

const EMPTY: Draft = { kind: "file", path: "", cluster: "", region: "", profile: "", project: "", location: "" };

function draftFrom(data: AuditEventsResponse): Draft {
  const c = data.cloud;
  if (c?.kind === "eks") return { ...EMPTY, kind: "eks", cluster: c.cluster, region: c.region ?? "", profile: c.profile ?? "" };
  if (c?.kind === "gke") return { ...EMPTY, kind: "gke", cluster: c.cluster, project: c.project, location: c.location };
  return { ...EMPTY, path: data.path ?? "" };
}

function cloudSource(d: Draft): AuditCloudSource | null {
  const t = (v: string) => v.trim();
  if (d.kind === "eks" && t(d.cluster)) {
    return { kind: "eks", cluster: t(d.cluster), ...(t(d.region) ? { region: t(d.region) } : {}), ...(t(d.profile) ? { profile: t(d.profile) } : {}) };
  }
  if (d.kind === "gke" && t(d.project) && t(d.location) && t(d.cluster)) {
    return { kind: "gke", project: t(d.project), location: t(d.location), cluster: t(d.cluster) };
  }
  return null;
}

const SOURCE_HINT: Record<SourceKind, string> = {
  file: "A local copy of the API server's audit log: a kind node mount, a kubeadm control plane, or a file synced from your provider.",
  eks: "Reads the last two hours from CloudWatch Logs with your own aws CLI and credentials. EKS writes there only with control plane audit logging enabled for the cluster.",
  gke: "Reads the last two hours of Cloud Audit Logs with your own gcloud CLI and credentials. Admin Activity logs are always on; Secret reads need Data Access logs enabled for the Kubernetes Engine API.",
};

/**
 * Intelligence roadmap Tier 3 #26: a retrospective security feed from the
 * cluster's own API server audit log, read from a local file the user points
 * at. No in-cluster agent; the precondition is audit logging already on.
 */
export function AuditSecurityFeedCard({ cluster }: { cluster: string }) {
  const qc = useQueryClient();
  const key = ["audit-security-events", cluster];
  const q = useQuery({
    queryKey: key,
    queryFn: () => securityApi.auditEvents(cluster),
    enabled: !!cluster,
    // A cloud source runs the provider CLI against a billed API: poll it gently.
    refetchInterval: (query) => (query.state.data?.source && query.state.data.source !== "file" ? 120_000 : 30_000),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [severity, setSeverity] = useState("");

  const data = q.data;
  const events = useMemo(() => (data?.events ?? []).filter((e) => !severity || e.severity === severity), [data, severity]);
  const editing = draft !== null || (data && !data.configured);
  const form = draft ?? EMPTY;
  const update = (patch: Partial<Draft>) => setDraft({ ...form, ...patch });
  const ready = form.kind === "file" ? !!form.path.trim() : !!cloudSource(form);

  async function save(run: () => Promise<unknown>) {
    setBusy(true);
    setSaveError("");
    try {
      await run();
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
          ClusterRoleBinding changes, anonymous requests that succeeded, and people reading Secrets (one person&apos;s
          reads close together show as one row). This needs the API server&apos;s audit log: a file on this machine
          (rotated copies next to it are read too), or an EKS or GKE cluster&apos;s managed audit log through your own
          aws or gcloud CLI. Privileged-pod and binding details need the policy to log at Request level for pods and
          RBAC objects.
        </div>
        {q.isLoading && <SkeletonLines lines={3} label="Loading audit events…" />}
        {q.error && <InlineBanner tone="warn" flush>{q.error instanceof Error ? q.error.message : String(q.error)}</InlineBanner>}
        {data && editing && (
          <Stack gap={2}>
            <Row gap={2} align="center" wrap>
              <Select aria-label="Audit log source" value={form.kind} onChange={(e) => update({ kind: e.target.value as SourceKind })}>
                <option value="file">Log file on this machine</option>
                <option value="eks">EKS (CloudWatch Logs)</option>
                <option value="gke">GKE (Cloud Logging)</option>
              </Select>
              {form.kind === "file" && (
                <TextField
                  aria-label="Audit log path"
                  placeholder="/var/log/kubernetes/audit/audit.log"
                  value={form.path}
                  onChange={(e) => update({ path: e.target.value })}
                  style={{ minWidth: 0, flex: "1 1 280px" }}
                />
              )}
              {form.kind === "eks" && (
                <>
                  <TextField aria-label="EKS cluster name" placeholder="cluster name" value={form.cluster} onChange={(e) => update({ cluster: e.target.value })} />
                  <TextField aria-label="AWS region" placeholder="region (optional)" value={form.region} onChange={(e) => update({ region: e.target.value })} />
                  <TextField aria-label="AWS profile" placeholder="profile (optional)" value={form.profile} onChange={(e) => update({ profile: e.target.value })} />
                </>
              )}
              {form.kind === "gke" && (
                <>
                  <TextField aria-label="Google Cloud project" placeholder="project ID" value={form.project} onChange={(e) => update({ project: e.target.value })} />
                  <TextField aria-label="GKE location" placeholder="region or zone" value={form.location} onChange={(e) => update({ location: e.target.value })} />
                  <TextField aria-label="GKE cluster name" placeholder="cluster name" value={form.cluster} onChange={(e) => update({ cluster: e.target.value })} />
                </>
              )}
              <Button
                disabled={busy || !ready}
                onClick={() =>
                  void save(() => (form.kind === "file" ? securityApi.setAuditLogPath(cluster, form.path.trim()) : securityApi.setAuditSource(cluster, cloudSource(form))))
                }
              >
                {form.kind === "file" ? "Save path" : "Save source"}
              </Button>
              {data.configured && (
                <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              )}
            </Row>
            <div className="muted small">{SOURCE_HINT[form.kind]}</div>
          </Stack>
        )}
        {saveError && <InlineBanner flush>{saveError}</InlineBanner>}
        {data?.configured && !editing && (
          <Row gap={2} align="center" wrap>
            <span className="muted small">
              Reading <span className="mono">{data.path}</span>
            </span>
            <Button variant="ghost" onClick={() => setDraft(draftFrom(data))}>
              Change
            </Button>
            <Button variant="danger-ghost" disabled={busy} onClick={() => void save(() => securityApi.setAuditLogPath(cluster, ""))}>
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
              {
                key: "time",
                header: "Time",
                className: "mono small",
                render: (e) => (
                  <Stack gap={1}>
                    <span>{e.time}</span>
                    {e.firstTime && <span className="muted">{`since ${e.firstTime}`}</span>}
                  </Stack>
                ),
              },
              {
                key: "event",
                header: "Event",
                render: (e) => (
                  <Row gap={2} align="center">
                    <Badge tone={TONE[e.severity]}>{e.severity}</Badge>
                    <span>{e.title}</span>
                    {e.count && e.count > 1 ? <Badge>{`×${e.count}`}</Badge> : null}
                  </Row>
                ),
              },
              { key: "who", header: "Who", className: "mono small", render: (e) => (e.sourceIP ? `${e.user} (${e.sourceIP})` : e.user) },
              {
                key: "object",
                header: "Object",
                className: "mono small",
                render: (e) => {
                  const href = auditObjectHref(e.ref);
                  return href ? <Link to={href}>{e.object}</Link> : e.object;
                },
              },
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
