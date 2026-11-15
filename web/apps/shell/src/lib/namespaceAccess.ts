import { useEffect, useMemo } from "react";
import { useCluster } from "./useCluster";
import { useResourceStream } from "./useResourceStream";
import { useClusterMeta } from "./cluster-meta-store";
import { useNamespaceStore, useSelectedNamespaces } from "./namespace-store";

// ADR 0003: an identity whose RBAC stops at some namespaces can't list
// namespaces, so it names the ones it uses: the kubeconfig context's, then
// the ones typed into the picker, remembered per cluster. Nothing here
// guesses or discovers; the stream says which ones it is refused.

/** A DNS-1123 label, which is what a namespace name must be. */
export function isNamespaceName(s: string): boolean {
  return s.length > 0 && s.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(s);
}

/** The context namespace first, then the remembered ones, each once. */
export function namedNamespaces(contextNs: string | undefined, remembered: readonly string[]): string[] {
  return [...new Set([...(contextNs ? [contextNs] : []), ...remembered])];
}

/** A single-namespace page's choices: the listed namespaces, else the named
 *  ones when namespaces can't be listed, and "default" only when there is
 *  nothing else. */
export function namespaceOptions(listed: readonly string[], forbidden: boolean, named: readonly string[]): string[] {
  if (!forbidden && listed.length > 0) return [...listed].sort();
  if (forbidden && named.length > 0) return [...named];
  return ["default"];
}

const NONE: string[] = [];

export interface NamespaceAccess {
  /** The namespaces stream's rows, when it can list them. */
  rows: Record<string, unknown>[];
  /** The rows are the cluster's whole list. */
  synced: boolean;
  /** The API server's reason when namespaces can't be listed. */
  forbidden?: string;
  contextNs?: string;
  remembered: string[];
  named: string[];
}

/** `enabled: false` opens no namespaces stream, for a page that asks only
 *  once something else is refused. */
export function useNamespaceAccess(cluster: string | undefined, { enabled = true }: { enabled?: boolean } = {}): NamespaceAccess {
  const namespaces = useResourceStream(cluster, "v1/namespaces", { mode: "metadata", enabled });
  const { list } = useCluster();
  const contextNs = list.find((c) => c.id === cluster)?.namespace;
  const remembered = useClusterMeta((s) => (cluster ? s.meta[cluster]?.namespaces : undefined) ?? NONE);
  const named = useMemo(() => namedNamespaces(contextNs, remembered), [contextNs, remembered]);
  return { rows: namespaces.rows, synced: namespaces.synced, forbidden: namespaces.forbidden, contextNs, remembered, named };
}

/**
 * Mounted once in the shell. When the cluster won't list namespaces and
 * nothing is selected, it selects the named ones, so every page that honours
 * the selection subscribes where this identity can read. A selection the
 * person made is left alone, and an admin never sees it act.
 */
export function useNamespaceFallback(cluster: string | undefined): void {
  const { forbidden, named } = useNamespaceAccess(cluster);
  const selected = useSelectedNamespaces(cluster);
  const setNamespaces = useNamespaceStore((s) => s.setNamespaces);
  useEffect(() => {
    if (cluster && forbidden && selected.length === 0 && named.length > 0) setNamespaces(cluster, named);
  }, [cluster, forbidden, selected.length, named, setNamespaces]);
}
