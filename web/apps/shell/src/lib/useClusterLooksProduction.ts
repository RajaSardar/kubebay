import { useContext } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { contextOf, looksProduction, type ClusterRef } from "./localshell";

/**
 * The terminal dock's "looks like production" check (ADR 0005, localshell.ts),
 * applied to a cluster id and its kubeconfig context. Advisory, a name check
 * only. Reads the clusters list from the query cache if there is one, so a
 * component under test with no QueryClientProvider falls back to the id alone.
 */
export function useClusterLooksProduction(cluster: string): { production: boolean; context: string } {
  const client = useContext(QueryClientContext);
  const clusters = client?.getQueryData<ClusterRef[]>(["clusters"]) ?? [];
  const context = contextOf(cluster, clusters);
  return { production: looksProduction(cluster, context), context };
}
