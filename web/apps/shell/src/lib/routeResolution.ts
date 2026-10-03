import type { CRDEntry } from "./api";

type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return v && typeof v === "object" ? (v as Obj) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export type RouteIssue =
  | { kind: "service-missing"; service: string }
  | { kind: "port-missing"; service: string; port: string }
  | { kind: "no-ready-endpoints"; service: string }
  | { kind: "class-missing"; className: string }
  | { kind: "no-class" }
  | { kind: "tls-secret-missing"; secret: string }
  | { kind: "gateway-missing"; gateway: string }
  | { kind: "status-condition"; type: string; reason: string; message: string };

export interface RoutePath {
  host: string;
  path: string;
  backend: string;
  issues: RouteIssue[];
}

export interface RouteResolution {
  routeKind: "Ingress" | "HTTPRoute";
  namespace: string;
  name: string;
  /** Issues with the route object itself (class, TLS, parent Gateway, controller status). */
  issues: RouteIssue[];
  paths: RoutePath[];
}

export function isRouteBroken(r: RouteResolution): boolean {
  return r.issues.length > 0 || r.paths.some((p) => p.issues.length > 0);
}

export interface GatewayApiDetection {
  httpRouteGvr?: string;
  gatewayGvr?: string;
}

export function detectGatewayApi(crds: CRDEntry[]): GatewayApiDetection {
  const find = (resource: string) => crds.find((c) => c.group === "gateway.networking.k8s.io" && c.resource === resource)?.gvr;
  const out: GatewayApiDetection = {};
  const httpRouteGvr = find("httproutes");
  const gatewayGvr = find("gateways");
  if (httpRouteGvr) out.httpRouteGvr = httpRouteGvr;
  if (gatewayGvr) out.gatewayGvr = gatewayGvr;
  return out;
}

const key = (ns: string, name: string) => `${ns}/${name}`;

/** Service lookup plus a ready-endpoint count per Service, shared by both route kinds. */
function backendIndex(services: Obj[], endpointSlices: Obj[]) {
  const svcs = new Map<string, Obj>();
  for (const s of services) svcs.set(key(str(rec(s.metadata).namespace), str(rec(s.metadata).name)), s);

  // null = no EndpointSlice data for the Service, so readiness can't be judged.
  const ready = new Map<string, number>();
  for (const es of endpointSlices) {
    const meta = rec(es.metadata);
    const k = key(str(meta.namespace), str(rec(meta.labels)["kubernetes.io/service-name"]));
    let n = ready.get(k) ?? 0;
    for (const ep of arr(es.endpoints)) {
      if (rec(rec(ep).conditions).ready !== false) n += arr(rec(ep).addresses).length || 1;
    }
    ready.set(k, n);
  }

  return (ns: string, name: string, port: { number?: number; name?: string }): RouteIssue[] => {
    const svc = svcs.get(key(ns, name));
    if (!svc) return [{ kind: "service-missing", service: name }];
    const spec = rec(svc.spec);
    const ports = arr(spec.ports).map(rec);
    const portOk =
      port.number !== undefined
        ? ports.some((p) => p.port === port.number)
        : port.name
          ? ports.some((p) => str(p.name) === port.name)
          : true;
    if (!portOk) return [{ kind: "port-missing", service: name, port: String(port.number ?? port.name) }];
    if (str(spec.type) === "ExternalName") return [];
    const n = ready.get(key(ns, name));
    if (n === 0) return [{ kind: "no-ready-endpoints", service: name }];
    return [];
  };
}

/**
 * Roadmap Tier 2 #13: resolves each Ingress rule to Service → port → ready
 * endpoints and names the first hop that breaks, plus Ingress-level
 * problems (a missing IngressClass, no class and no default, a TLS Secret
 * that isn't there). Only `spec.ingressClassName` is checked against
 * IngressClass objects; the legacy `kubernetes.io/ingress.class` annotation
 * counts as a class, since controllers match it without an object.
 */
export function resolveIngressRoutes(input: {
  ingresses: Obj[];
  ingressClasses: Obj[];
  services: Obj[];
  endpointSlices: Obj[];
  secrets: Obj[];
}): RouteResolution[] {
  const check = backendIndex(input.services, input.endpointSlices);
  const classes = new Set(input.ingressClasses.map((c) => str(rec(c.metadata).name)));
  const hasDefault = input.ingressClasses.some(
    (c) => str(rec(rec(c.metadata).annotations)["ingressclass.kubernetes.io/is-default-class"]) === "true",
  );
  const secrets = new Set(input.secrets.map((s) => key(str(rec(s.metadata).namespace), str(rec(s.metadata).name))));

  return input.ingresses.map((ing) => {
    const meta = rec(ing.metadata);
    const ns = str(meta.namespace);
    const spec = rec(ing.spec);
    const issues: RouteIssue[] = [];

    const className = str(spec.ingressClassName);
    const legacyClass = str(rec(meta.annotations)["kubernetes.io/ingress.class"]);
    if (className && !classes.has(className)) issues.push({ kind: "class-missing", className });
    else if (!className && !legacyClass && !hasDefault) issues.push({ kind: "no-class" });

    for (const t of arr(spec.tls)) {
      const secret = str(rec(t).secretName);
      if (secret && !secrets.has(key(ns, secret))) issues.push({ kind: "tls-secret-missing", secret });
    }

    const pathFor = (host: string, path: string, backend: Obj): RoutePath => {
      const service = rec(backend.service);
      const port = rec(service.port);
      const name = str(service.name);
      if (!name) return { host, path, backend: str(rec(backend.resource).kind) || "(resource)", issues: [] };
      const p = typeof port.number === "number" ? { number: port.number } : { name: str(port.name) };
      return { host, path, backend: `${name}:${p.number ?? p.name}`, issues: check(ns, name, p) };
    };

    const paths: RoutePath[] = [];
    for (const r of arr(spec.rules)) {
      const host = str(rec(r).host) || "*";
      for (const p of arr(rec(rec(r).http).paths)) paths.push(pathFor(host, str(rec(p).path) || "/", rec(rec(p).backend)));
    }
    if (spec.defaultBackend) paths.push(pathFor("*", "(default backend)", rec(spec.defaultBackend)));

    return { routeKind: "Ingress", namespace: ns, name: str(meta.name), issues, paths };
  });
}

/**
 * Gateway API half of #13: parent Gateways must exist (namespace defaults to
 * the route's), Service backendRefs resolve like Ingress backends, and any
 * Accepted/ResolvedRefs condition the controller set to False is surfaced
 * as-is. Cross-namespace backendRefs are resolved but ReferenceGrants aren't
 * checked here; the controller's ResolvedRefs condition covers that.
 */
export function resolveHttpRoutes(input: { httpRoutes: Obj[]; gateways: Obj[]; services: Obj[]; endpointSlices: Obj[] }): RouteResolution[] {
  const check = backendIndex(input.services, input.endpointSlices);
  const gateways = new Set(input.gateways.map((g) => key(str(rec(g.metadata).namespace), str(rec(g.metadata).name))));

  return input.httpRoutes.map((route) => {
    const meta = rec(route.metadata);
    const ns = str(meta.namespace);
    const spec = rec(route.spec);
    const issues: RouteIssue[] = [];

    for (const ref of arr(spec.parentRefs).map(rec)) {
      if ((str(ref.kind) || "Gateway") !== "Gateway") continue;
      const gw = key(str(ref.namespace) || ns, str(ref.name));
      if (!gateways.has(gw)) issues.push({ kind: "gateway-missing", gateway: gw });
    }
    for (const parent of arr(rec(route.status).parents)) {
      for (const c of arr(rec(parent).conditions).map(rec)) {
        if ((c.type === "Accepted" || c.type === "ResolvedRefs") && c.status === "False") {
          issues.push({ kind: "status-condition", type: str(c.type), reason: str(c.reason), message: str(c.message) });
        }
      }
    }

    const host = arr(spec.hostnames).map(str).join(", ") || "*";
    const paths: RoutePath[] = [];
    for (const rule of arr(spec.rules).map(rec)) {
      const matchPaths = arr(rule.matches).map((m) => str(rec(rec(m).path).value)).filter(Boolean);
      const path = matchPaths.join(", ") || "/";
      for (const b of arr(rule.backendRefs).map(rec)) {
        if ((str(b.kind) || "Service") !== "Service" || str(b.group)) continue;
        const name = str(b.name);
        const port = typeof b.port === "number" ? { number: b.port } : {};
        paths.push({ host, path, backend: `${name}:${b.port ?? ""}`, issues: check(str(b.namespace) || ns, name, port) });
      }
    }

    return { routeKind: "HTTPRoute", namespace: ns, name: str(meta.name), issues, paths };
  });
}
