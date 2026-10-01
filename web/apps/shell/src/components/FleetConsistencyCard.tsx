import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, DataTable, Row, SkeletonLines, Stack, type BadgeTone } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";
import { useStaggeredEnable } from "../lib/useStaggeredEnable";
import { compareFleet, type ClusterObjects, type DriftSeverity, type FieldDrift, type MissingObject, type ObjectDrift } from "../lib/fleetConsistency";

const SEVERITY_TONE: Record<DriftSeverity, BadgeTone | undefined> = { high: "err", medium: "warn", low: undefined };
const MAX_VALUE = 60;
const MAX_ROWS = 200;

interface Collected extends ClusterObjects {
  synced: boolean;
}

/** Streams one cluster's compared kinds and hands them up; renders nothing. */
function ClusterCollector({ cluster, index, onCollected }: { cluster: string; index: number; onCollected: (c: Collected) => void }) {
  const enabled = useStaggeredEnable(index, 3, 500);
  const target = enabled ? cluster : undefined;
  const deployments = useResourceStream(target, "apps/v1/deployments", { mode: "full", enabled });
  const statefulsets = useResourceStream(target, "apps/v1/statefulsets", { mode: "full", enabled });
  const daemonsets = useResourceStream(target, "apps/v1/daemonsets", { mode: "full", enabled });
  const configmaps = useResourceStream(target, "v1/configmaps", { mode: "full", enabled });
  const synced = enabled && deployments.synced && statefulsets.synced && daemonsets.synced && configmaps.synced;
  useEffect(() => {
    onCollected({
      cluster,
      synced,
      objects: { deployments: deployments.rows, statefulsets: statefulsets.rows, daemonsets: daemonsets.rows, configmaps: configmaps.rows },
    });
  }, [cluster, synced, deployments.rows, statefulsets.rows, daemonsets.rows, configmaps.rows, onCollected]);
  return null;
}

function sameRows(a: unknown[], b: unknown[]) {
  return a === b || (a.length === 0 && b.length === 0);
}

function sameCollected(a: Collected | undefined, b: Collected) {
  if (!a || a.synced !== b.synced) return false;
  const ka = a.objects;
  const kb = b.objects;
  return sameRows(ka.deployments, kb.deployments) && sameRows(ka.statefulsets, kb.statefulsets) && sameRows(ka.daemonsets, kb.daemonsets) && sameRows(ka.configmaps, kb.configmaps);
}

function objectLabel(o: { kind: string; namespace: string; name: string }) {
  return `${o.kind} ${o.namespace}/${o.name}`;
}

function valueCell(v: string | undefined) {
  if (v === undefined) return <span className="muted">not set</span>;
  return v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v || '""';
}

type FieldRow = { drift: ObjectDrift; field: FieldDrift };

/**
 * Intelligence roadmap Tier 3 #25: the same Deployment, StatefulSet,
 * DaemonSet or ConfigMap compared field by field across connected clusters.
 * Read-only and opt-in, since it opens four full streams per cluster.
 */
export function FleetConsistencyCard({ clusters }: { clusters: string[] }) {
  const [running, setRunning] = useState(false);
  const [collected, setCollected] = useState<Record<string, Collected>>({});
  const onCollected = useCallback(
    (c: Collected) => setCollected((prev) => (sameCollected(prev[c.cluster], c) ? prev : { ...prev, [c.cluster]: c })),
    [],
  );

  const ready = running && clusters.length > 0 && clusters.every((c) => collected[c]?.synced);
  const result = useMemo(
    () => (ready ? compareFleet(clusters.map((c) => collected[c]!)) : null),
    [ready, clusters, collected],
  );
  const fieldRows = useMemo<FieldRow[]>(
    () => (result ? result.drifts.flatMap((drift) => drift.fields.map((field) => ({ drift, field }))) : []),
    [result],
  );

  return (
    <Card>
      <Stack gap={3}>
        <Row align="center" gap={2} wrap>
          <strong>Fleet consistency</strong>
          <Badge>read-only</Badge>
          {result && (
            <span className="small">
              {`${result.compared} object${result.compared === 1 ? "" : "s"} in more than one cluster, ${result.drifts.length} differ${result.drifts.length === 1 ? "s" : ""}.`}
            </span>
          )}
        </Row>
        <div className="muted small">
          Deployments, StatefulSets, DaemonSets and ConfigMaps with the same namespace and name, compared by image,
          resources, env and replicas. Secret-backed env vars show the secret they reference, never its value. kube-*
          namespaces are skipped.
        </div>
        {clusters.length < 2 ? (
          <div className="muted small">Connect at least two clusters to compare them.</div>
        ) : !running ? (
          <Row>
            <Button variant="ghost" onClick={() => setRunning(true)}>Compare clusters</Button>
          </Row>
        ) : (
          <>
            {clusters.map((c, i) => (
              <ClusterCollector key={c} cluster={c} index={i} onCollected={onCollected} />
            ))}
            {!result ? (
              <SkeletonLines lines={3} label="Loading clusters to compare…" />
            ) : (
              <>
                <DataTable
                  wrap={false}
                  rows={fieldRows.slice(0, MAX_ROWS)}
                  rowKey={(r) => `${objectLabel(r.drift)}:${r.field.path}`}
                  empty={<div className="muted small">Every object held by more than one cluster matches.</div>}
                  columns={[
                    { key: "object", header: "Object", className: "mono small", render: (r) => objectLabel(r.drift) },
                    { key: "field", header: "Field", className: "mono small", render: (r) => r.field.path },
                    { key: "sev", header: "Impact", render: (r) => <Badge tone={SEVERITY_TONE[r.field.severity]}>{r.field.severity}</Badge> },
                    ...clusters.map((c) => ({
                      key: `c:${c}`,
                      header: c,
                      className: "mono small",
                      title: (r: FieldRow) => r.field.values[c],
                      render: (r: FieldRow) => (r.drift.clusters.includes(c) ? valueCell(r.field.values[c]) : <span className="muted">no object</span>),
                    })),
                  ]}
                />
                {fieldRows.length > MAX_ROWS && (
                  <div className="muted small">{`Showing the first ${MAX_ROWS} of ${fieldRows.length} differing fields.`}</div>
                )}
                {result.missing.length > 0 && (
                  <>
                    <div className="muted small">Only in some clusters, though the namespace exists in all of them</div>
                    <DataTable
                      wrap={false}
                      rows={result.missing.slice(0, MAX_ROWS)}
                      rowKey={(m: MissingObject) => objectLabel(m)}
                      columns={[
                        { key: "object", header: "Object", className: "mono small", render: (m) => objectLabel(m) },
                        { key: "in", header: "Present in", className: "mono small", render: (m) => m.presentIn.join(", ") },
                        { key: "out", header: "Missing from", className: "mono small", render: (m) => m.missingFrom.join(", ") },
                      ]}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
