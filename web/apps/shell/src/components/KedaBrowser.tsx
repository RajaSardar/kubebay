import { useMemo, useState } from "react";
import { Badge, Card, EmptyState, Row, SegmentedControl, Stack, TextField } from "@kubebay/ui";
import { KedaInventory } from "./KedaInventory";
import { ResourceLink } from "./ResourceLink";
import { filterKedaRows, toKedaRows } from "../lib/keda";
import type { KedaKind, OrphanedTriggerAuth } from "../lib/keda";
import { extSlug } from "../lib/resources";

type View = "all" | KedaKind;

function nameOf(o: Record<string, unknown>): string {
  const n = (o.metadata as { name?: unknown } | undefined)?.name;
  return typeof n === "string" ? n : "";
}
function nsOf(o: Record<string, unknown>): string {
  const n = (o.metadata as { namespace?: unknown } | undefined)?.namespace;
  return typeof n === "string" ? n : "";
}

/**
 * KEDA page body, mirroring the CRDs page: a search box over everything KEDA
 * ships, plus a kind switch with an "All" view across ScaledObjects,
 * ScaledJobs, TriggerAuthentications and ClusterTriggerAuthentications.
 * The ScaledObjects view keeps the rich inventory (conflicts, scale-to-zero,
 * paused); the other views are flat lists linking to each resource.
 */
export function KedaBrowser({
  scaledObjects,
  scaledJobs,
  triggerAuths,
  clusterTriggerAuths,
  hpas,
  orphanedTriggerAuths,
  scaledObjectGvr,
  scaledJobGvr,
  triggerAuthGvr,
  clusterTriggerAuthGvr,
}: {
  scaledObjects: Record<string, unknown>[];
  scaledJobs: Record<string, unknown>[];
  triggerAuths: Record<string, unknown>[];
  clusterTriggerAuths: Record<string, unknown>[];
  hpas: Record<string, unknown>[];
  orphanedTriggerAuths: OrphanedTriggerAuth[];
  scaledObjectGvr?: string;
  scaledJobGvr?: string;
  triggerAuthGvr?: string;
  clusterTriggerAuthGvr?: string;
}) {
  const [view, setView] = useState<View>("ScaledObject");
  const [search, setSearch] = useState("");

  const allRows = useMemo(
    () => [
      ...toKedaRows("ScaledObject", scaledObjects, scaledObjectGvr),
      ...toKedaRows("ScaledJob", scaledJobs, scaledJobGvr),
      ...toKedaRows("TriggerAuthentication", triggerAuths, triggerAuthGvr),
      ...toKedaRows("ClusterTriggerAuthentication", clusterTriggerAuths, clusterTriggerAuthGvr),
    ],
    [scaledObjects, scaledJobs, triggerAuths, clusterTriggerAuths, scaledObjectGvr, scaledJobGvr, triggerAuthGvr, clusterTriggerAuthGvr],
  );

  const visible = useMemo(() => filterKedaRows(allRows, view, search), [allRows, view, search]);

  const matchingScaledObjects = useMemo(() => {
    const keep = new Set(filterKedaRows(allRows, "ScaledObject", search).map((r) => `${r.ns}/${r.name}`));
    return scaledObjects.filter((so) => keep.has(`${nsOf(so)}/${nameOf(so)}`));
  }, [allRows, scaledObjects, search]);

  const count = (k: KedaKind) => allRows.filter((r) => r.kind === k).length;

  return (
    <Stack gap={3}>
      <Row gap={2} align="center" wrap>
        <TextField
          placeholder="Search KEDA resources…"
          aria-label="Search KEDA resources"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          style={{ maxWidth: 280 }}
        />
        <SegmentedControl<View>
          label="KEDA kind"
          value={view}
          onChange={setView}
          options={[
            { value: "all", label: `All (${allRows.length})` },
            { value: "ScaledObject", label: `ScaledObjects (${count("ScaledObject")})` },
            { value: "ScaledJob", label: `ScaledJobs (${count("ScaledJob")})` },
            { value: "TriggerAuthentication", label: `TriggerAuthentications (${count("TriggerAuthentication")})` },
            { value: "ClusterTriggerAuthentication", label: `ClusterTriggerAuthentications (${count("ClusterTriggerAuthentication")})` },
          ]}
        />
      </Row>

      {view === "ScaledObject" ? (
        <KedaInventory
          scaledObjects={matchingScaledObjects}
          hpas={hpas}
          orphanedTriggerAuths={orphanedTriggerAuths}
          scaledObjectGvr={scaledObjectGvr}
          triggerAuthGvr={triggerAuthGvr}
          clusterTriggerAuthGvr={clusterTriggerAuthGvr}
        />
      ) : visible.length === 0 ? (
        <EmptyState>
          <p>{search ? "No KEDA resources match your search." : "No KEDA resources of this kind found on this cluster."}</p>
        </EmptyState>
      ) : (
        <Stack gap={2}>
          {visible.map((r) => (
            <Card key={`${r.kind}/${r.ns}/${r.name}`}>
              <Row align="center" gap={2}>
                <Badge>{r.kind}</Badge>
                {r.gvr ? (
                  <ResourceLink kind={`ext--${extSlug(r.gvr)}`} ns={r.ns} name={r.name}>
                    <span className="mono strong small">{r.name}</span>
                  </ResourceLink>
                ) : (
                  <span className="mono strong small">{r.name}</span>
                )}
                {r.ns && <span className="muted small">{r.ns}</span>}
              </Row>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
