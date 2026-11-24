/** A Service's endpoints, read from its EndpointSlices (label kubernetes.io/service-name). */

export interface EndpointRow {
  address: string;
  ready: boolean;
  node: string;
  target?: { kind: string; name: string; ns: string };
}
export interface EndpointPort {
  name: string;
  port: number;
  protocol: string;
}
export interface EndpointSummary {
  endpoints: EndpointRow[];
  ports: EndpointPort[];
  ready: number;
  notReady: number;
}

type Obj = Record<string, unknown>;
const rec = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// The API's meaning of an unset ready condition is "ready".
const isReady = (e: Obj) => rec(e.conditions).ready !== false;

export function summarizeEndpoints(slices: readonly Obj[]): EndpointSummary {
  const out: EndpointSummary = { endpoints: [], ports: [], ready: 0, notReady: 0 };
  const seenPorts = new Set<string>();
  for (const s of slices) {
    for (const e of arr(s.endpoints)) {
      const ready = isReady(e);
      const ref = rec(e.targetRef);
      const target = str(ref.name)
        ? { kind: str(ref.kind), name: str(ref.name), ns: str(ref.namespace) || str(rec(s.metadata).namespace) }
        : undefined;
      for (const address of (Array.isArray(e.addresses) ? e.addresses : []) as unknown[]) {
        const row: EndpointRow = { address: str(address), ready, node: str(e.nodeName) };
        if (target) row.target = target;
        out.endpoints.push(row);
        if (ready) out.ready++;
        else out.notReady++;
      }
    }
    for (const p of arr(s.ports)) {
      const port = { name: str(p.name), port: Number(p.port), protocol: str(p.protocol) || "TCP" };
      const key = `${port.name}/${port.port}/${port.protocol}`;
      if (!seenPorts.has(key)) {
        seenPorts.add(key);
        out.ports.push(port);
      }
    }
  }
  return out;
}

/** Ready and total endpoint addresses per `namespace/service`. */
export function endpointCountsByService(slices: readonly Obj[]): Map<string, { ready: number; total: number }> {
  const m = new Map<string, { ready: number; total: number }>();
  for (const s of slices) {
    const meta = rec(s.metadata);
    const svc = str(rec(meta.labels)["kubernetes.io/service-name"]);
    if (!svc) continue;
    const key = `${str(meta.namespace)}/${svc}`;
    const c = m.get(key) ?? { ready: 0, total: 0 };
    for (const e of arr(s.endpoints)) {
      const n = Array.isArray(e.addresses) ? e.addresses.length : 0;
      c.total += n;
      if (isReady(e)) c.ready += n;
    }
    m.set(key, c);
  }
  return m;
}
