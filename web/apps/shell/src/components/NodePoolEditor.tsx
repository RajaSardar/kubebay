import { useMemo } from "react";
import { YamlTab } from "./YamlTab";
import { computeNodePoolImpact } from "../lib/karpenterImpact";
import { detectDangerousChanges } from "../lib/karpenterDangerousChange";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Safe-editing surface for a Karpenter NodePool (backlog #3 P2): the blast-
 * radius banner ("backs N nodes / M pods / K namespaces…") sits above the
 * shared YamlTab, and the same YamlTab gates Apply behind type-to-confirm
 * whenever detectDangerousChanges flags the edit. NodePools are
 * cluster-scoped, so ns is always "".
 */
export function NodePoolEditor({
  cluster,
  gvr,
  name,
  nodes,
  pods,
  pdbs,
}: {
  cluster: string;
  gvr: string;
  name: string;
  nodes: Record<string, unknown>[];
  pods: Record<string, unknown>[];
  pdbs: Record<string, unknown>[];
}) {
  const impact = useMemo(() => computeNodePoolImpact(name, nodes, pods, pdbs), [name, nodes, pods, pdbs]);

  const banner = (
    <div className="inline-banner" role="status">
      Backs {plural(impact.nodeCount, "node")} / {plural(impact.podCount, "pod")} /{" "}
      {plural(impact.namespaceCount, "namespace")}
      {impact.pdbProtectedPodCount > 0 && (
        <> · {plural(impact.pdbProtectedPodCount, "pod")} covered by a PodDisruptionBudget</>
      )}
      {impact.spotCount > 0 && <> · {plural(impact.spotCount, "spot node")}</>}
    </div>
  );

  return (
    <YamlTab
      cluster={cluster}
      gvr={gvr}
      ns=""
      name={name}
      impactBanner={banner}
      dangerousChangeCheck={detectDangerousChanges}
    />
  );
}
