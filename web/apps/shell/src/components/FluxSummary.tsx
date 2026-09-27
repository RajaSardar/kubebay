import { Badge, Card } from "@kubebay/ui";
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
export function FluxSummary({ items }: { items: FluxObjectStatus[] }) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p>No Kustomizations or HelmReleases found.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it, i) => (
        <Card key={i}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Badge>{it.kind}</Badge>
            <span className="mono strong small">{it.name}</span>
            <span className="muted small">{it.ns}</span>
            <span style={{ marginLeft: "auto" }}>
              {it.ready === true && <Badge tone="ok">Ready</Badge>}
              {it.ready === false && <Badge tone="err">Not ready</Badge>}
              {it.ready === null && <Badge>Unknown</Badge>}
            </span>
          </div>
          {it.readyMessage && <div className="small" style={{ marginTop: 6 }}>{it.readyMessage}</div>}
          <div className="muted small" style={{ marginTop: 6 }}>
            manages {it.managedResourceCount} resource{it.managedResourceCount === 1 ? "" : "s"}
          </div>
          {it.driftEventCount > 0 && (
            <div className="small" style={{ marginTop: 6, color: "var(--kb-status-warn, #f59e0b)" }}>
              Drift detected ({it.driftEventCount}) — Flux already reconciled it back to the desired state.
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
