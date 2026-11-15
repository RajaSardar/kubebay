import { Badge, Card, EmptyState, InlineBanner, Row, Stack } from "@kubebay/ui";
import type { FluxObjectStatus } from "../lib/flux";

/**
 * Flux's own honestly-labelled section (backlog #12) — kept separate from
 * Argo's drift list since kustomize-controller *corrects* drift on
 * reconcile rather than reporting it, so there's no line-level diff to show
 * and no OutOfSync/Synced dichotomy to borrow from Argo. What's real:
 * Ready condition, how many resources this object currently manages, and
 * whether a drift-detection event fired (drift that already happened and
 * was already corrected by the time this renders).
 */
export function FluxSummary({ items, highlight }: { items: FluxObjectStatus[]; highlight?: string | null }) {
  if (items.length === 0) {
    return (
      <EmptyState>
        <p>No Kustomizations or HelmReleases found.</p>
      </EmptyState>
    );
  }

  // A "Managed by" link names one object: mark it, or say it is not here.
  const missing = !!highlight && !items.some((it) => it.name === highlight);
  return (
    <Stack gap={2}>
      {missing && <InlineBanner tone="warn">Flux object {highlight} isn&apos;t in this cluster.</InlineBanner>}
      {items.map((it, i) => (
        <Card key={i} selected={!!highlight && it.name === highlight}>
          <Row align="center" gap={2} wrap>
            <Badge>{it.kind}</Badge>
            <span className="mono strong small">{it.name}</span>
            <span className="muted small">{it.ns}</span>
            <span style={{ marginLeft: "auto" }}>
              {it.ready === true && <Badge tone="ok">Ready</Badge>}
              {it.ready === false && <Badge tone="err">Not ready</Badge>}
              {it.ready === null && <Badge>Unknown</Badge>}
            </span>
          </Row>
          {it.readyMessage && <div className="small" style={{ marginTop: 6 }}>{it.readyMessage}</div>}
          <div className="muted small" style={{ marginTop: 6 }}>
            manages {it.managedResourceCount} resource{it.managedResourceCount === 1 ? "" : "s"}
          </div>
          {it.driftEventCount > 0 && (
            <div className="small" style={{ marginTop: 6, color: "var(--kb-status-warn)" }}>
              Drift detected ({it.driftEventCount}) — Flux already reconciled it back to the desired state.
            </div>
          )}
        </Card>
      ))}
    </Stack>
  );
}
