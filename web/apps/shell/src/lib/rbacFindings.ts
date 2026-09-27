import type { RBACFinding } from "./api";

/** The role name half of a "ClusterRole:name" / "Role:name" roleRef. */
function roleNameOf(roleRef: string): string {
  const i = roleRef.indexOf(":");
  return i === -1 ? roleRef : roleRef.slice(i + 1);
}

/**
 * True for Kubernetes' own built-in control-plane roles (system:*), which
 * make up most of a real cluster's RBAC surface and are noise for a reviewer
 * looking for their own team's mistakes. Default-hidden in the UI, not
 * filtered server-side, so the raw data is still there if wanted.
 */
export function isSystemFinding(f: RBACFinding): boolean {
  return roleNameOf(f.roleRef).startsWith("system:");
}

export interface FindingQuery {
  verb: string;
  group: string;
  resource: string;
}

/**
 * Extracts the "who else can do this" query a finding carries, or null when
 * the finding is structural (wildcard, escalation verbs, cluster-admin) and
 * doesn't map onto one specific verb+resource check.
 */
export function findingQuery(f: RBACFinding): FindingQuery | null {
  if (!f.verb || !f.resource) return null;
  return { verb: f.verb, group: f.group ?? "", resource: f.resource };
}
