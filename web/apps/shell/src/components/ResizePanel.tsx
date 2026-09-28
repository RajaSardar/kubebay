import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, TextField } from "@kubebay/ui";
import { api, wasteApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { resolveWorkloadOwner } from "../lib/podOwner";
import { ownerOf, ownerLabel } from "../lib/gitops";
import {
  computeRightSizingRows,
  computeEngineRightSizingRows,
  mergeRightSizingRows,
  suggestedRequestsFor,
  gvrForWorkloadKind,
} from "../lib/rightsizing";

const FIELDS = [
  { key: "cpuRequest", label: "CPU request", section: "requests", res: "cpu", ph: "100m" },
  { key: "memRequest", label: "Mem request", section: "requests", res: "memory", ph: "128Mi" },
  { key: "cpuLimit", label: "CPU limit", section: "limits", res: "cpu", ph: "500m" },
  { key: "memLimit", label: "Mem limit", section: "limits", res: "memory", ph: "256Mi" },
] as const;

export function ResizePanel({
  cluster,
  namespace,
  pod,
  containers,
  podObj,
}: {
  cluster: string;
  namespace: string;
  pod: string;
  containers: string[];
  /** The pod's own object (for ownerReferences) — enables the right-sizing suggestion below. */
  podObj?: Record<string, unknown>;
}) {
  const container = containers[0] ?? "";
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Resolve this pod up to its owning Deployment/StatefulSet/DaemonSet (same
  // resolution the engine's own sampler does) so a right-sizing
  // recommendation already computed for that workload can be offered here.
  const directOwnerKind = (() => {
    const refs = (podObj?.metadata as Record<string, unknown> | undefined)?.ownerReferences;
    const ref = Array.isArray(refs) ? (refs.find((r) => (r as Record<string, unknown>).controller === true) as Record<string, unknown> | undefined) : undefined;
    return (ref?.kind as string) ?? "";
  })();
  const needsReplicaSets = directOwnerKind === "ReplicaSet";
  const replicaSets = useResourceStream(needsReplicaSets ? cluster : undefined, "apps/v1/replicasets", { mode: "full", enabled: needsReplicaSets });

  const owner = useMemo(() => {
    if (!podObj) return null;
    if (directOwnerKind === "ReplicaSet" && !replicaSets.synced && replicaSets.rows.length === 0) return null;
    return resolveWorkloadOwner(podObj, namespace, replicaSets.rows);
  }, [podObj, namespace, directOwnerKind, replicaSets.rows, replicaSets.synced]);

  const ownerGvr = owner ? gvrForWorkloadKind(owner.kind) : "";
  const vpas = useResourceStream(owner ? cluster : undefined, "autoscaling.k8s.io/v1/verticalpodautoscalers", { mode: "full", enabled: !!owner });
  const ownerWorkloads = useResourceStream(owner ? cluster : undefined, ownerGvr || "v1/configmaps", { mode: "full", enabled: !!owner });
  const hpas = useResourceStream(owner ? cluster : undefined, "autoscaling/v2/horizontalpodautoscalers", { mode: "full", enabled: !!owner });
  const wasteQ = useQuery({
    queryKey: ["waste-workloads", cluster],
    queryFn: () => wasteApi.workloads(cluster),
    enabled: !!owner,
    refetchInterval: 30_000,
    retry: false,
  });

  const suggestion = useMemo(() => {
    if (!owner || !container) return null;
    const vpaRows = computeRightSizingRows({ vpas: vpas.rows, workloads: ownerWorkloads.rows, hpas: hpas.rows });
    const engineRows = computeEngineRightSizingRows(wasteQ.data ?? [], hpas.rows);
    const merged = mergeRightSizingRows(vpaRows, engineRows);
    const s = suggestedRequestsFor(merged, { ns: namespace, kind: owner.kind, name: owner.name, container });
    if (!s) return null;
    const fromVpa = merged.some((r) => r.source === "vpa" && r.workloadName === owner.name && r.container === container);
    return { ...s, workloadLevel: !fromVpa };
  }, [owner, container, vpas.rows, ownerWorkloads.rows, hpas.rows, wasteQ.data, namespace]);

  function useSuggested() {
    if (!suggestion) return;
    setVals((v) => ({ ...v, cpuRequest: suggestion.cpu, memRequest: suggestion.memory }));
  }

  function copyAsPatch() {
    const resources: { requests?: Record<string, string>; limits?: Record<string, string> } = {};
    for (const f of FIELDS) {
      const v = vals[f.key]?.trim();
      if (v) resources[f.section] = { ...(resources[f.section] ?? {}), [f.res]: v };
    }
    const patch = { spec: { containers: [{ name: container, resources }] } };
    void navigator.clipboard?.writeText(JSON.stringify(patch, null, 2)).catch(() => {});
  }

  const live = useQuery({
    queryKey: ["resize-current", cluster, namespace, pod],
    queryFn: () => api.getObject(cluster, "v1/pods", namespace, pod),
    staleTime: 15_000,
    retry: 1,
    retryDelay: 2000,
    refetchOnWindowFocus: false,
    enabled: !!cluster && !!namespace && !!pod,
  });

  function current(section: string, res: string): string {
    const doc = live.data as
      | { spec?: { containers?: { name: string; resources?: Record<string, Record<string, string>> }[] } }
      | undefined;
    const c = doc?.spec?.containers?.find((x) => x.name === container);
    return c?.resources?.[section]?.[res] ?? "";
  }

  async function apply() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const resources: { requests?: Record<string, string>; limits?: Record<string, string> } = {};
      for (const f of FIELDS) {
        const v = vals[f.key]?.trim();
        if (v) {
          resources[f.section] = { ...(resources[f.section] ?? {}), [f.res]: v };
        }
      }
      const gitopsOwner = podObj ? ownerOf(podObj) : null;
      await api.resizePod({
        cluster,
        ns: namespace,
        name: pod,
        container,
        resources,
        gitopsOwner: gitopsOwner ? ownerLabel(gitopsOwner) : undefined,
      });
      setMsg("Patched — in-place if the pod allows it, otherwise on restart.");
      await live.refetch();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (!container) return <div className="muted small" style={{ padding: 14 }}>No container selected.</div>;

  return (
    <div style={{ padding: 14 }}>
      <div className="rbac-section-title">Resize container "{container}"</div>
      {live.isLoading && <div className="muted small" style={{ marginBottom: 8 }}>Loading current resources…</div>}
      {live.isError && <div className="error-banner" style={{ marginBottom: 10 }}>Could not load current resources.</div>}
      {suggestion && (
        <div className="inline-banner" role="status" style={{ marginBottom: 10 }}>
          Suggested{suggestion.workloadLevel ? " (workload-level, not container-exact)" : ""}: cpu {suggestion.cpu} /
          memory {suggestion.memory}.{" "}
          <Button variant="ghost" onClick={useSuggested}>
            Use suggested
          </Button>
        </div>
      )}
      <div className="pf-form" style={{ gridTemplateColumns: "repeat(2, minmax(160px, 1fr))" }}>
        {FIELDS.map((f) => (
          <label key={f.key} className="ctl" style={{ flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
            <span className="muted small">{f.label} <span className="subtle">({current(f.section, f.res) || "unset"})</span></span>
            <TextField
              style={{ width: "100%" }}
              placeholder={f.ph}
              value={vals[f.key] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              spellCheck={false}
            />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
        <Button disabled={busy || live.isLoading} onClick={() => void apply()}>
          {busy ? "Patching…" : "Apply resize"}
        </Button>
        <Button variant="ghost" onClick={copyAsPatch}>
          Copy as patch
        </Button>
        {msg && <span className="small" style={{ color: "var(--kb-status-ok)" }}>{msg}</span>}
        {err && <span className="error-text small">{err}</span>}
        {!msg && !err && <Badge>K8s ≥1.33 in-place</Badge>}
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        Only filled fields are patched. Restart behaviour follows each container's <span className="mono">resizePolicy</span>.
      </p>
    </div>
  );
}
