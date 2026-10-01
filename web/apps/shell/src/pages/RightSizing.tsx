import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DiffEditor } from "@monaco-editor/react";
import { ArmedButton, Badge, Button, Card, EmptyState, InlineBanner, PageHeader, Row, Stack } from "@kubebay/ui";
import { PageLoader } from "../components/PageLoader";
import { InstallVpaRecommender } from "../components/InstallVpaRecommender";
import { CreateVpaObject } from "../components/CreateVpaObject";
import { RightSizingTable, rowKey, type Selection } from "../components/RightSizingTable";
import { useResourceStream, shouldShowSkeleton } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { useMonacoTheme } from "../lib/theme";
import { api, crdApi, wasteApi } from "../lib/api";
import { ownerLabel } from "../lib/gitops";
import { detectVpa } from "../lib/vpa";
import {
  computeRightSizingRows,
  computeEngineRightSizingRows,
  mergeRightSizingRows,
  formatCpuMillis,
  formatMemBytes,
  cpuQuantityString,
  memQuantityString,
  gvrForWorkloadKind,
  buildResizePatchYaml,
  resizeApplyRequest,
  type RightSizingRow,
  type ContainerPatch,
} from "../lib/rightsizing";

interface WorkloadPlan {
  ns: string;
  kind: string;
  name: string;
  gitopsOwner: RightSizingRow["gitopsOwner"];
  patches: ContainerPatch[];
  rows: RightSizingRow[];
}

interface PreviewState {
  status: "idle" | "loading" | "ready" | "error";
  original?: string;
  resultYaml?: string;
  error?: string;
}

function rowWorkloadKey(r: Pick<RightSizingRow, "ns" | "workloadKind" | "workloadName">): string {
  return `${r.ns}/${r.workloadKind}/${r.workloadName}`;
}

function planWorkloadKey(p: Pick<WorkloadPlan, "ns" | "kind" | "name">): string {
  return `${p.ns}/${p.kind}/${p.name}`;
}

function buildPlans(rows: RightSizingRow[], selection: Selection): WorkloadPlan[] {
  const byWorkload = new Map<string, WorkloadPlan>();
  for (const r of rows) {
    // Engine-sourced rows are view-only in v2 — no real per-container split
    // to build a patch from (the sampler aggregates to the whole workload).
    // Actuating on them is v3 scope.
    if (r.source !== "vpa") continue;
    const sel = selection[rowKey(r)];
    if (!sel || (!sel.cpu && !sel.memory)) continue;
    const wk = rowWorkloadKey(r);
    const plan = byWorkload.get(wk) ?? {
      ns: r.ns,
      kind: r.workloadKind,
      name: r.workloadName,
      gitopsOwner: r.gitopsOwner,
      patches: [],
      rows: [],
    };
    plan.patches.push({
      name: r.container,
      cpu: sel.cpu ? cpuQuantityString(r.targetCpuMillis) : undefined,
      memory: sel.memory ? memQuantityString(r.targetMemBytes) : undefined,
    });
    plan.rows.push(r);
    byWorkload.set(wk, plan);
  }
  return [...byWorkload.values()];
}

export default function RightSizing() {
  const { cluster: effectiveCluster } = useCluster();
  const monacoTheme = useMonacoTheme();

  const vpas = useResourceStream(effectiveCluster || undefined, "autoscaling.k8s.io/v1/verticalpodautoscalers", { mode: "full" });
  const deployments = useResourceStream(effectiveCluster || undefined, "apps/v1/deployments", { mode: "full" });
  const statefulsets = useResourceStream(effectiveCluster || undefined, "apps/v1/statefulsets", { mode: "full" });
  const daemonsets = useResourceStream(effectiveCluster || undefined, "apps/v1/daemonsets", { mode: "full" });
  const hpas = useResourceStream(effectiveCluster || undefined, "autoscaling/v2/horizontalpodautoscalers", { mode: "full" });

  // CRD-based "is the recommender even installed" detection, independent of
  // whether any VerticalPodAutoscaler object exists yet — installing the
  // recommender (InstallVpaRecommender) creates zero VPA objects on its own,
  // so `vpas.rows.length === 0` alone can't tell "not installed" apart from
  // "installed, nothing targets it yet".
  const crds = useQuery({
    queryKey: ["crds", effectiveCluster],
    queryFn: () => crdApi.list(effectiveCluster),
    enabled: !!effectiveCluster,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const vpaDetection = useMemo(() => detectVpa(crds.data ?? []), [crds.data]);

  const workloads = useMemo(
    () => [...deployments.rows, ...statefulsets.rows, ...daemonsets.rows],
    [deployments.rows, statefulsets.rows, daemonsets.rows],
  );

  const wasteQ = useQuery({
    queryKey: ["waste-workloads", effectiveCluster],
    queryFn: () => wasteApi.workloads(effectiveCluster),
    enabled: !!effectiveCluster,
    refetchInterval: 30_000,
    retry: false,
  });

  const rows = useMemo(() => {
    const vpaRows = computeRightSizingRows({ vpas: vpas.rows, workloads, hpas: hpas.rows });
    const engineRows = computeEngineRightSizingRows(wasteQ.data ?? [], hpas.rows);
    return mergeRightSizingRows(vpaRows, engineRows);
  }, [vpas.rows, workloads, hpas.rows, wasteQ.data]);

  // Engine-sourced rows are exactly the workloads Kubebay already has
  // waste/usage visibility into that no VPA object covers yet — the natural,
  // already-ranked candidate list for "create a real VPA object here too".
  const vpaCandidates = useMemo(() => rows.filter((r) => r.source !== "vpa"), [rows]);

  const [selection, setSelection] = useState<Selection>({});

  // Seed a sensible default selection as new rows arrive, without clobbering
  // choices the user already made for a row it's seen before.
  useEffect(() => {
    setSelection((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const r of rows) {
        const key = rowKey(r);
        if (next[key]) continue;
        next[key] = { cpu: r.cpuMaterial && !r.hpaCpuConflict, memory: r.memMaterial };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  function toggle(key: string, dim: "cpu" | "memory") {
    setSelection((prev) => ({
      ...prev,
      [key]: { cpu: prev[key]?.cpu ?? false, memory: prev[key]?.memory ?? false, [dim]: !prev[key]?.[dim] },
    }));
  }

  const plans = useMemo(() => buildPlans(rows, selection), [rows, selection]);

  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [applyBusy, setApplyBusy] = useState<Record<string, boolean>>({});

  async function previewPlan(plan: WorkloadPlan) {
    const key = planWorkloadKey(plan);
    setPreviews((p) => ({ ...p, [key]: { status: "loading" } }));
    try {
      const gvr = gvrForWorkloadKind(plan.kind);
      const [original, dryRun] = await Promise.all([
        api.getYamlText(effectiveCluster, gvr, plan.ns, plan.name),
        api.applyYaml(resizeApplyRequest(effectiveCluster, plan, plan.patches, true)),
      ]);
      setPreviews((p) => ({ ...p, [key]: { status: "ready", original, resultYaml: dryRun.resultYaml ?? original } }));
    } catch (e) {
      setPreviews((p) => ({ ...p, [key]: { status: "error", error: String(e instanceof Error ? e.message : e) } }));
    }
  }

  async function applyPlan(plan: WorkloadPlan) {
    const key = planWorkloadKey(plan);
    setApplyBusy((b) => ({ ...b, [key]: true }));
    try {
      await api.applyYaml(resizeApplyRequest(effectiveCluster, plan, plan.patches, false));
      setPreviews((p) => ({ ...p, [key]: { status: "ready", resultYaml: p[key]?.resultYaml, original: p[key]?.resultYaml } }));
    } catch (e) {
      setPreviews((p) => ({ ...p, [key]: { status: "error", error: String(e instanceof Error ? e.message : e) } }));
    } finally {
      setApplyBusy((b) => ({ ...b, [key]: false }));
    }
  }

  async function copyPatch(plan: WorkloadPlan) {
    const yaml = buildResizePatchYaml(plan, plan.patches);
    try {
      await navigator.clipboard.writeText(yaml);
    } catch {
      /* clipboard unavailable — silently ignore, the yaml is still visible in the preview */
    }
  }

  const anyLoading =
    shouldShowSkeleton(vpas.synced, vpas.rows.length) &&
    shouldShowSkeleton(deployments.synced, deployments.rows.length);

  const totalWastedCpu = rows.reduce((s, r) => s + r.wastedCpuMillis, 0);
  const totalWastedMem = rows.reduce((s, r) => s + r.wastedMemBytes, 0);

  if (!effectiveCluster) {
    return (
      <div className="page">
        <PageHeader level={2} title="Right-sizing" />
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }

  if (anyLoading) {
    return (
      <div className="page">
        <PageHeader level={2} title="Right-sizing" />
        <PageLoader message="Loading VPA recommendations…" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        level={2}
        title="Right-sizing"
        count={
          <>
            · {rows.length} opportunit{rows.length === 1 ? "y" : "ies"} · {formatCpuMillis(totalWastedCpu)} /{" "}
            {formatMemBytes(totalWastedMem)} wasted fleet-wide
          </>
        }
      />

      <div className="page-body">
        {vpas.rows.length === 0 && !crds.isLoading && !vpaDetection.installed && (
          <EmptyState style={{ marginBottom: 16 }}>
            <p>No VPA recommender detected on this cluster.</p>
            <p className="muted small">
              Kubebay's own metrics-server-based recommendations (below, badged "Kubebay") still work without one —
              install the VPA recommender too (with <code className="mono">updateMode: "Off"</code> to keep it
              observe-only) for a purpose-built alternative on the same workloads.
            </p>
            <InstallVpaRecommender cluster={effectiveCluster} />
          </EmptyState>
        )}

        {vpas.rows.length === 0 && !crds.isLoading && vpaDetection.installed && (
          <EmptyState style={{ marginBottom: 16 }}>
            <p>VPA recommender is installed, but no VerticalPodAutoscaler objects exist yet.</p>
            <p className="muted small">
              The recommender only computes recommendations for VerticalPodAutoscaler objects that already target a
              workload — installing the controller alone doesn't create any. Kubebay's own metrics-server-based
              recommendations (below, badged "Kubebay") still work without one; create a VPA (
              <code className="mono">updateMode: "Off"</code>, observe-only) for a workload below to also get
              real VPA-sourced data.
            </p>
            {vpaCandidates.length > 0 && (
              <Stack gap={2} style={{ marginTop: 12 }}>
                {vpaCandidates.slice(0, 10).map((r) => (
                  <Row key={`${r.ns}/${r.workloadKind}/${r.workloadName}`} align="center" justify="between" gap={2} wrap>
                    <span className="small">
                      <span className="mono strong">{r.workloadName}</span>
                      <span className="muted"> · {r.workloadKind} · {r.ns}</span>
                    </span>
                    <CreateVpaObject cluster={effectiveCluster} ns={r.ns} kind={r.workloadKind} name={r.workloadName} />
                  </Row>
                ))}
              </Stack>
            )}
          </EmptyState>
        )}

        <RightSizingTable rows={rows} selected={selection} onToggle={toggle} />

        {plans.length > 0 && (
          <Stack gap={3} style={{ marginTop: 16 }}>
            {plans.map((plan) => {
              const key = planWorkloadKey(plan);
              const preview = previews[key];
              return (
                <Card key={key}>
                  <Row align="center" justify="between" wrap gap={2}>
                    <div>
                      <span className="mono strong">{plan.name}</span>
                      <span className="muted small"> · {plan.kind} · {plan.ns}</span>
                      {plan.gitopsOwner && <Badge>{ownerLabel(plan.gitopsOwner)}</Badge>}
                    </div>
                    <Row gap={2}>
                      <Button variant="ghost" onClick={() => void previewPlan(plan)}>
                        {preview?.status === "loading" ? "Previewing…" : "Preview dry-run"}
                      </Button>
                      {plan.gitopsOwner ? (
                        <Button variant="ghost" onClick={() => void copyPatch(plan)}>
                          Copy patch
                        </Button>
                      ) : (
                        <ArmedButton
                          label="Apply"
                          confirmLabel={`Apply to ${plan.rows.reduce((s, r) => s + r.replicas, 0)} pods across ${plan.patches.length} container(s)?`}
                          variant="primary"
                          busy={applyBusy[key] || preview?.status !== "ready"}
                          onGo={() => void applyPlan(plan)}
                        />
                      )}
                    </Row>
                  </Row>

                  {preview?.status === "error" && <InlineBanner flush style={{ marginTop: 10 }}>{preview.error}</InlineBanner>}

                  {preview?.status === "ready" && preview.original !== undefined && (
                    <div style={{ marginTop: 10, height: 220, border: "1px solid var(--kb-border-subtle)", borderRadius: 6, overflow: "hidden" }}>
                      <DiffEditor
                        original={preview.original}
                        modified={preview.resultYaml ?? preview.original}
                        language="yaml"
                        theme={monacoTheme}
                        options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12, automaticLayout: true }}
                      />
                    </div>
                  )}

                  {plan.gitopsOwner && (
                    <div className="muted small" style={{ marginTop: 8 }}>
                      GitOps-managed — a direct apply would just be reverted on the next sync. Copy the patch and commit it to the
                      Git source instead.
                    </div>
                  )}
                </Card>
              );
            })}
          </Stack>
        )}
      </div>
    </div>
  );
}
