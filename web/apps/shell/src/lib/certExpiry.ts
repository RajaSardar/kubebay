type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return v && typeof v === "object" ? (v as Obj) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export type CertificateState = "expired" | "expiring" | "not-ready" | "ok";

/** A certificate this close to notAfter counts as expiring. */
export const CERT_SOON_MS = 14 * 86_400_000;

/**
 * Where a cert-manager Certificate stands: past notAfter (expired), within 14
 * days of it (expiring), not Ready with time left (not-ready), or fine. Shared
 * by the Best practices check and the Issues queue so both agree.
 */
export function certificateState(cert: Obj, now: number): CertificateState {
  const st = rec(cert.status);
  const exp = Date.parse(str(st.notAfter));
  const conds = Array.isArray(st.conditions) ? st.conditions : [];
  const ready = conds.some((x) => str(rec(x).type) === "Ready" && str(rec(x).status) === "True");
  if (!Number.isNaN(exp) && exp < now) return "expired";
  if (!ready) return "not-ready";
  if (!Number.isNaN(exp) && exp < now + CERT_SOON_MS) return "expiring";
  return "ok";
}
