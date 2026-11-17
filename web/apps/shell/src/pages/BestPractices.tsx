import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, CollapsibleSection, EmptyState, PageHeader, Row, Stack, type BadgeTone } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { PageLoader } from "../components/PageLoader";
import { discoveryApi } from "../lib/api";
import { useCluster } from "../lib/useCluster";
import { useResourceStream, type StreamState } from "../lib/useResourceStream";
import {
  computeBestPractices,
  type BestPracticeCheck,
  type CheckGroup,
  type CheckStatus,
} from "../lib/bestPractices";

const GROUP_ORDER: CheckGroup[] = ["Reliability", "Security", "Disaster recovery", "Platform"];
const STATUS_TONE: Record<CheckStatus, BadgeTone | undefined> = { pass: "ok", fail: "warn", unknown: undefined };
const STATUS_LABEL: Record<CheckStatus, string> = { pass: "Pass", fail: "Fail", unknown: "Unknown" };

/** The stream's rows once it has them; undefined while it can't give any (RBAC forbids it, or it hasn't synced). */
function rowsOf(s: StreamState): Record<string, unknown>[] | undefined {
  if (s.forbidden) return undefined;
  return s.synced ? s.rows : undefined;
}

function CheckCard({ check }: { check: BestPracticeCheck }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Stack gap={1}>
        <Row align="center" gap={2} wrap>
          <Badge tone={STATUS_TONE[check.status]}>{STATUS_LABEL[check.status]}</Badge>
          <strong>{check.title}</strong>
        </Row>
        <div className="small">{check.detail}</div>
        {check.offenders && check.offenders.length > 0 && (
          <div className="small mono muted">e.g. {check.offenders.join(", ")}</div>
        )}
        <div className="small muted">Why it matters: {check.why}</div>
        {check.link && check.status === "pass" && (
          <div className="small">
            <Link to={check.link}>{check.linkLabel ?? "Open"}</Link>
          </div>
        )}
        {check.link && check.status === "fail" && !check.install && (
          <div className="small">
            <Link to={check.link}>{check.linkLabel ?? "Open"}</Link>
          </div>
        )}
        {check.install && (
          <CollapsibleSection title="How to install" level="sub" open={open} onToggle={() => setOpen((o) => !o)}>
            <Stack gap={1}>
              <div className="small muted">
                {check.install.tool}'s own instructions, as text only. Kubebay doesn't run these; copy them to your terminal.
              </div>
              {check.install.commands.map((c) => (
                <code key={c} className="mono small" style={{ display: "block", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {c}
                </code>
              ))}
              <a className="small" href={check.install.docsUrl} target="_blank" rel="noreferrer">
                Official install guide
              </a>
            </Stack>
          </CollapsibleSection>
        )}
      </Stack>
    </Card>
  );
}

/**
 * Backlog #36: a best-practices checklist for the connected cluster, built from
 * what the app already streams plus API discovery. Read-only: it never installs
 * anything, it shows the install command as text.
 */
export default function BestPractices() {
  const { cluster } = useCluster();
  const c = cluster || undefined;
  const deployments = useResourceStream(c, "apps/v1/deployments", { mode: "full" });
  const statefulsets = useResourceStream(c, "apps/v1/statefulsets", { mode: "full" });
  const pdbs = useResourceStream(c, "policy/v1/poddisruptionbudgets", { mode: "full" });
  const netpols = useResourceStream(c, "networking.k8s.io/v1/networkpolicies", { mode: "full" });
  const namespaces = useResourceStream(c, "v1/namespaces", { mode: "full" });
  const ingressClasses = useResourceStream(c, "networking.k8s.io/v1/ingressclasses", { mode: "full" });
  const apisQ = useQuery({
    queryKey: ["apis", cluster],
    queryFn: () => discoveryApi.apis(cluster!),
    enabled: !!cluster,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const streams = [deployments, statefulsets, pdbs, netpols, namespaces, ingressClasses];
  const waiting = streams.some((s) => !s.forbidden && !s.synced) || apisQ.isLoading;

  const checks = useMemo(
    () =>
      computeBestPractices({
        deployments: rowsOf(deployments),
        statefulsets: rowsOf(statefulsets),
        pdbs: rowsOf(pdbs),
        networkPolicies: rowsOf(netpols),
        namespaces: rowsOf(namespaces),
        ingressClasses: rowsOf(ingressClasses),
        apiGroups: apisQ.data ? [...new Set(apisQ.data.map((a) => a.group))] : undefined,
      }),
    // The streams' state objects change on every flush; their rows are what the checks read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deployments.rows, deployments.synced, deployments.forbidden, statefulsets.rows, statefulsets.synced, statefulsets.forbidden, pdbs.rows, pdbs.synced, pdbs.forbidden, netpols.rows, netpols.synced, netpols.forbidden, namespaces.rows, namespaces.synced, namespaces.forbidden, ingressClasses.rows, ingressClasses.synced, ingressClasses.forbidden, apisQ.data],
  );

  const header = <PageHeader help={<PageHelp route="/best-practices" />} level={2} title="Best practices" />;

  if (!cluster) {
    return (
      <div className="page">
        {header}
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }
  if (waiting) {
    return (
      <div className="page">
        {header}
        <PageLoader message="Checking this cluster…" />
      </div>
    );
  }

  const passing = checks.filter((k) => k.status === "pass").length;
  return (
    <div className="page">
      <PageHeader help={<PageHelp route="/best-practices" />} level={2} title="Best practices" count={`· ${passing} of ${checks.length} pass`} />
      <div className="page-body">
        <Stack gap={4}>
          {GROUP_ORDER.map((g) => (
            <section key={g}>
              <strong style={{ display: "block", marginBottom: 8 }}>{g}</strong>
              <Stack as="ul" gap={2} style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {checks
                  .filter((k) => k.group === g)
                  .map((k) => (
                    <li key={k.id}>
                      <CheckCard check={k} />
                    </li>
                  ))}
              </Stack>
            </section>
          ))}
        </Stack>
      </div>
    </div>
  );
}
