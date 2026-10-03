import type { AuditObjectRef } from "./api";
import { DEFS, EXTRA_DEFS } from "./resources";

/**
 * Where an audit event's object lives in the app: pods open in their drawer
 * on the Pods page, kinds with a generic detail page go there, anything else
 * (RBAC bindings, a list with no name) has no link.
 */
export function auditObjectHref(ref: AuditObjectRef | undefined): string | null {
  if (!ref?.name) return null;
  if (ref.resource === "pods") {
    return ref.namespace ? `/workloads?${new URLSearchParams({ pod: `${ref.namespace}/${ref.name}` }).toString()}` : null;
  }
  if (!DEFS[ref.resource] && !EXTRA_DEFS[ref.resource]) return null;
  return `/detail/${ref.resource}/${ref.namespace || "_"}/${ref.name}`;
}
