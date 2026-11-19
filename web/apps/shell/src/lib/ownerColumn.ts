import { kindSlug } from "./useOwnerChain";

/**
 * The Owner column (backlog 54): the object's controller from its own
 * metadata.ownerReferences (controller=true). Kubernetes ownership only: the
 * Helm release and the GitOps app are separate ideas shown elsewhere.
 */
export interface OwnerCell {
  /** "Deployment/web", or "—" when nothing controls the object. */
  text: string;
  kind: string;
  name: string;
  /** The owner's detail page; unset for a bare object. */
  href?: string;
}

interface Ref {
  apiVersion: string;
  kind: string;
  name: string;
}

const NONE: OwnerCell = { text: "—", kind: "", name: "" };

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function controllerRef(obj: unknown): Ref | null {
  const refs = rec(rec(obj).metadata).ownerReferences;
  if (!Array.isArray(refs)) return null;
  for (const r of refs) {
    const rr = rec(r);
    if (rr.controller === true && str(rr.kind) && str(rr.name)) {
      return { apiVersion: str(rr.apiVersion), kind: str(rr.kind), name: str(rr.name) };
    }
  }
  return null;
}

const key = (ns: string, name: string) => `${ns}/${name}`;

/** Each ReplicaSet's own controller (a Deployment, or an Argo Rollout), by "ns/name". */
export function replicaSetOwners(replicaSets: readonly unknown[]): Map<string, Ref> {
  const m = new Map<string, Ref>();
  for (const rs of replicaSets) {
    const owner = controllerRef(rs);
    if (!owner) continue;
    const meta = rec(rec(rs).metadata);
    m.set(key(str(meta.namespace), str(meta.name)), owner);
  }
  return m;
}

/**
 * The cell for one object. A ReplicaSet controller is looked through to the
 * Deployment (or Rollout) above it when `rsOwners` knows it, so pods of a
 * Deployment read "Deployment/web"; any other owner is shown as it is.
 */
export function ownerCellOf(obj: unknown, rsOwners?: ReadonlyMap<string, Ref>): OwnerCell {
  const meta = rec(rec(obj).metadata);
  const ns = str(meta.namespace);
  let owner = controllerRef(obj);
  if (!owner) return NONE;
  if (owner.kind === "ReplicaSet" && owner.apiVersion.startsWith("apps/")) {
    owner = rsOwners?.get(key(ns, owner.name)) ?? owner;
  }
  // Cluster-scoped owners (a static pod's Node) live at "_"; the rest share the object's namespace.
  const slug = kindSlug(owner.kind, owner.apiVersion);
  const ownerNs = owner.kind === "Node" ? "_" : ns || "_";
  return {
    text: `${owner.kind}/${owner.name}`,
    kind: owner.kind,
    name: owner.name,
    href: `/detail/${slug}/${ownerNs}/${owner.name}`,
  };
}
