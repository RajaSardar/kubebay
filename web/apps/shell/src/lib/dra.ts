/**
 * KB-12: Dynamic Resource Allocation (resource.k8s.io/v1, GA in Kubernetes
 * 1.34). Readers for the DRA tables' columns and the Pod drawer's claims. The
 * v1 request shape (`exactly`, `firstAvailable`) is read, and so is the beta
 * shape with `deviceClassName` on the request itself.
 */

type Obj = Record<string, unknown>;

const rec = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const orDash = (s: string) => s || "–";

/** A claim's STATE as `kubectl get resourceclaims` prints it. */
export function claimState(o: Obj): { v: string; dot: "ok" | "warn" | "err" } {
  if (rec(o.metadata).deletionTimestamp) return { v: "deleted", dot: "err" };
  const status = rec(o.status);
  if (!status.allocation) return { v: "pending", dot: "warn" };
  return { v: arr(status.reservedFor).length > 0 ? "allocated,reserved" : "allocated", dot: "ok" };
}

/** The device classes a claim spec asks for; alternatives are joined with |. */
export function claimDeviceClasses(spec: unknown): string {
  const classes = arr(rec(rec(spec).devices).requests).map((r) => {
    const exactly = str(rec(r.exactly).deviceClassName) || str(r.deviceClassName);
    if (exactly) return exactly;
    return arr(r.firstAvailable)
      .map((s) => str(s.deviceClassName))
      .filter(Boolean)
      .join(" | ");
  });
  return orDash([...new Set(classes.filter(Boolean))].join(", "));
}

/** The devices allocated to a claim, as pool/device. */
export function claimDevices(o: Obj): string {
  const results = arr(rec(rec(rec(o.status).allocation).devices).results);
  return orDash(results.map((r) => [str(r.pool), str(r.device)].filter(Boolean).join("/")).join(", "));
}

/** Who a claim is reserved for (pods, usually). */
export function claimUsers(o: Obj): string {
  return orDash(arr(rec(o.status).reservedFor).map((r) => str(r.name)).filter(Boolean).join(", "));
}

const DRIVER_RE = /device\.driver\s*==\s*(["'])([^"']+)\1/;

/** The driver a DeviceClass selects, when a CEL selector pins one. */
export function classDriver(o: Obj): string {
  for (const s of arr(rec(o.spec).selectors)) {
    const m = DRIVER_RE.exec(str(rec(s.cel).expression));
    if (m?.[2]) return m[2];
  }
  return "–";
}

/** Which nodes a ResourceSlice's devices are reachable from. */
export function sliceNodes(o: Obj): string {
  const spec = rec(o.spec);
  if (str(spec.nodeName)) return str(spec.nodeName);
  if (spec.allNodes === true) return "all nodes";
  if (spec.nodeSelector) return "selected nodes";
  if (spec.perDeviceNodeSelection === true) return "per device";
  return "–";
}

export interface PodClaim {
  /** The name the pod gives the claim in spec.resourceClaims. */
  name: string;
  /** The ResourceClaim object, once there is one. */
  claim?: string;
  /** The template the claim is made from, if any. */
  template?: string;
}

/** The ResourceClaims a pod uses, resolved to their objects where they exist. */
export function podResourceClaims(pod: unknown): PodClaim[] {
  const p = rec(pod);
  const made = new Map(arr(rec(p.status).resourceClaimStatuses).map((s) => [str(s.name), str(s.resourceClaimName)]));
  return arr(rec(p.spec).resourceClaims).map((c) => {
    const name = str(c.name);
    const out: PodClaim = { name };
    const claim = str(c.resourceClaimName) || made.get(name) || "";
    if (claim) out.claim = claim;
    if (str(c.resourceClaimTemplateName)) out.template = str(c.resourceClaimTemplateName);
    return out;
  });
}
