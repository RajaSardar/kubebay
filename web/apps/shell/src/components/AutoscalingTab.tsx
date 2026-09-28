import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, EmptyState, InlineBanner } from "@kubebay/ui";
import { crdApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { explainScaledObject, hpaConflictsWithScaledObject } from "../lib/keda";
import { KedaWizard } from "./heavy";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Pure rendering of whatever autoscalers already target this workload —
 * data fetching lives in AutoscalingTab below so this half can be unit
 * tested without standing up streams. Backlog #2 P1+P2: a "Managed by
 * KEDA" badge, min/max/current for each autoscaler kind, the plain-English
 * ScaledObject explain, and the two safety flags that matter in practice
 * (minReplicaCount: 0, and an HPA fighting the same target).
 */
export function AutoscalingSummary({
  scaledObjects,
  hpas,
  vpas,
}: {
  scaledObjects: Record<string, unknown>[];
  hpas: Record<string, unknown>[];
  vpas: Record<string, unknown>[];
}) {
  if (scaledObjects.length === 0 && hpas.length === 0 && vpas.length === 0) {
    return (
      <EmptyState style={{ padding: 14 }}>
        <p>No autoscaler targets this workload.</p>
      </EmptyState>
    );
  }

  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      {scaledObjects.map((so, i) => {
        const explain = explainScaledObject(so);
        const conflict = hpaConflictsWithScaledObject(so, hpas);
        return (
          <Card key={i}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Badge tone="ok">Managed by KEDA</Badge>
              <span className="mono strong small">{explain.name}</span>
              {explain.paused && <Badge>paused</Badge>}
            </div>
            <div className="small" style={{ marginTop: 8 }}>{explain.summary}</div>
            <div className="muted small" style={{ marginTop: 4 }}>
              min {explain.minReplicas} / max {explain.maxReplicas}
              {explain.currentReplicas !== undefined ? ` / current ${explain.currentReplicas}` : ""}
            </div>
            {explain.minReplicaZero && (
              <div className="small" style={{ marginTop: 8, color: "var(--kb-status-warn)" }}>
                ⚠ scale-to-zero (minReplicaCount: 0) — the workload can go idle between triggers.
              </div>
            )}
            {conflict && (
              <InlineBanner flush style={{ marginTop: 8 }}>
                Conflict: an HPA also targets {explain.targetKind.toLowerCase()} "{explain.targetName}" — dual ownership causes
                replica flapping. Remove one.
              </InlineBanner>
            )}
          </Card>
        );
      })}

      {hpas.map((h, i) => {
        const meta = rec(h.metadata);
        const spec = rec(h.spec);
        const current = rec(h.status).currentReplicas;
        return (
          <Card key={`hpa-${i}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge>HPA</Badge>
              <span className="mono strong small">{str(meta.name)}</span>
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>
              min {String(spec.minReplicas ?? "–")} / max {String(spec.maxReplicas ?? "–")}
              {typeof current === "number" ? ` / current ${current}` : ""}
            </div>
          </Card>
        );
      })}

      {vpas.map((v, i) => {
        const meta = rec(v.metadata);
        const updateMode = str(rec(rec(v.spec).updatePolicy).updateMode) || "Off";
        return (
          <Card key={`vpa-${i}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge>VPA</Badge>
              <span className="mono strong small">{str(meta.name)}</span>
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>update mode: {updateMode}</div>
          </Card>
        );
      })}
    </div>
  );
}

function targets(obj: Record<string, unknown>, refPath: "scaleTargetRef" | "targetRef", ns: string, name: string, kind: string): boolean {
  const meta = rec(obj.metadata);
  if (str(meta.namespace) !== ns) return false;
  const ref = rec(rec(obj.spec)[refPath]);
  return str(ref.name) === name && (str(ref.kind) || "Deployment") === kind;
}

/**
 * Data-fetching half: finds the live ScaledObject GVR via CRD discovery
 * (KEDA detection is "nearly free" per the backlog — no engine changes,
 * just filter /api/crds) so the stream subscription only ever targets a
 * GVR discovery already confirmed exists, then filters HPA/VPA/ScaledObject
 * streams down to whatever targets this specific workload.
 */
export function AutoscalingTab({
  cluster,
  ns,
  name,
  kind,
}: {
  cluster: string;
  ns: string;
  name: string;
  kind: string;
}) {
  const crds = useQuery({
    queryKey: ["crds", cluster],
    queryFn: () => crdApi.list(cluster),
    enabled: !!cluster,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const scaledObjectGvr = useMemo(
    () => crds.data?.find((e) => e.group === "keda.sh" && e.resource === "scaledobjects")?.gvr,
    [crds.data],
  );

  const scaledObjects = useResourceStream(scaledObjectGvr ? cluster : undefined, scaledObjectGvr ?? "", {
    mode: "full",
    enabled: !!scaledObjectGvr,
  });
  const hpas = useResourceStream(cluster, "autoscaling/v2/horizontalpodautoscalers", { mode: "full" });
  const vpas = useResourceStream(cluster, "autoscaling.k8s.io/v1/verticalpodautoscalers", { mode: "full" });

  const myScaledObjects = useMemo(
    () => scaledObjects.rows.filter((o) => targets(o, "scaleTargetRef", ns, name, kind)),
    [scaledObjects.rows, ns, name, kind],
  );
  const myHpas = useMemo(() => hpas.rows.filter((o) => targets(o, "scaleTargetRef", ns, name, kind)), [hpas.rows, ns, name, kind]);
  const myVpas = useMemo(() => vpas.rows.filter((o) => targets(o, "targetRef", ns, name, kind)), [vpas.rows, ns, name, kind]);

  const [showWizard, setShowWizard] = useState(false);
  const wizardTargetKind = kind === "StatefulSet" ? "StatefulSet" : "Deployment";
  // Only streamed once the wizard is actually open — a cluster-wide Services
  // watch isn't worth paying for on every workload drawer, just to suggest
  // Prometheus trigger candidates.
  const services = useResourceStream(cluster, "v1/services", { mode: "full", enabled: showWizard });

  return (
    <div>
      <AutoscalingSummary scaledObjects={myScaledObjects} hpas={myHpas} vpas={myVpas} />
      {scaledObjectGvr && (
        <div style={{ padding: "0 14px 14px" }}>
          {!showWizard ? (
            <Button variant="ghost" onClick={() => setShowWizard(true)}>
              + Add ScaledObject
            </Button>
          ) : (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px 0" }}>
                <span className="mono strong small">New ScaledObject</span>
                <Button variant="ghost" onClick={() => setShowWizard(false)}>
                  Cancel
                </Button>
              </div>
              <KedaWizard
                cluster={cluster}
                ns={ns}
                targetKind={wizardTargetKind}
                targetName={name}
                hpas={myHpas}
                services={services.rows}
                onApplied={() => setShowWizard(false)}
              />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
