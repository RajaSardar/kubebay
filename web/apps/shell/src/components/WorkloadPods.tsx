import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, DataTable, StatusPill } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";
import { podTone } from "../lib/pods";
import { workloadLabelSelector, workloadPods } from "../lib/workloadPods";
import { LiveAge } from "./LiveAge";

const INITIAL = 50;

/**
 * All of a workload's pods, at the bottom of its Summary: name, ready, status,
 * restarts, node and age. A row opens the pod. Streams live, so a pod that
 * restarts or is replaced during a rollout updates in place.
 */
export function WorkloadPods({ cluster, obj: given, kind }: { cluster: string; obj: Record<string, unknown>; kind?: string }) {
  const navigate = useNavigate();
  // A fetched object may not carry its kind; the drawer knows it.
  const obj = useMemo(() => (kind ? { ...given, kind } : given), [given, kind]);
  const [all, setAll] = useState(false);
  const meta = (obj.metadata ?? {}) as { namespace?: string };
  const ns = meta.namespace ? [meta.namespace] : undefined;
  const labelSelector = workloadLabelSelector(obj) || undefined;
  const isDeployment = obj.kind === "Deployment";
  const pods = useResourceStream(cluster || undefined, "v1/pods", { mode: "full", ns, labelSelector });
  const sets = useResourceStream(cluster || undefined, "apps/v1/replicasets", { mode: "full", ns, labelSelector, enabled: isDeployment });
  const rows = useMemo(() => workloadPods(obj, pods.rows, isDeployment ? sets.rows : []), [obj, pods.rows, sets.rows, isDeployment]);
  const shown = all ? rows : rows.slice(0, INITIAL);
  const loading = !pods.synced && rows.length === 0;

  return (
    <div className="pod-section">
      <div className="pod-section-title">{`Pods (${rows.length})`}</div>
      <DataTable
        rows={shown}
        rowKey={(r) => r.key}
        loading={loading}
        loadingLabel="Loading pods…"
        onRowClick={(r) => navigate(`/detail/pods/${r.namespace || "_"}/${r.name}`)}
        empty={<span className="muted small">No pods: this workload has none running right now.</span>}
        columns={[
          { key: "name", header: "Name", className: "mono td-name", title: (r) => r.name, render: (r) => r.name },
          { key: "ready", header: "Ready", className: "mono small", render: (r) => r.ready },
          {
            key: "status",
            header: "Status",
            title: (r) => r.statusDetail || undefined,
            render: (r) => <StatusPill tone={podTone(r)}>{r.statusLabel}</StatusPill>,
          },
          { key: "restarts", header: "Restarts", className: "mono small", align: "right", render: (r) => r.restarts },
          { key: "node", header: "Node", className: "mono small", title: (r) => r.node, render: (r) => r.node || "–" },
          { key: "age", header: "Age", className: "small", title: (r) => r.created, render: (r) => <LiveAge ts={r.created} /> },
        ]}
      />
      {rows.length > INITIAL && !all && (
        <div style={{ marginTop: 8 }}>
          <Button onClick={() => setAll(true)}>{`Show all ${rows.length} pods`}</Button>
        </div>
      )}
    </div>
  );
}
