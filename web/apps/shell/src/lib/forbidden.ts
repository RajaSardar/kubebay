/** A stream RBAC forbids: what it lists, and the API server's reason. */
export interface Denied {
  what: string;
  reason: string;
}

/**
 * The streams a page waits on that RBAC forbids, in the order given. The
 * engine ends such a stream, so it never syncs: a page that would keep
 * showing its loader says what it can't list instead (ForbiddenState).
 */
export function deniedStreams(streams: Record<string, { forbidden?: string }>): Denied[] {
  return Object.entries(streams).flatMap(([what, s]) => (s.forbidden ? [{ what, reason: s.forbidden }] : []));
}

/** "pods", "pods and nodes", "pods, nodes and deployments". */
export function listKinds(kinds: readonly string[]): string {
  if (kinds.length <= 1) return kinds[0] ?? "";
  return `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}`;
}
