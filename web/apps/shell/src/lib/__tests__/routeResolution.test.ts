import { describe, it, expect } from "vitest";
import { resolveIngressRoutes, resolveHttpRoutes, detectGatewayApi, isRouteBroken } from "../routeResolution";
import type { CRDEntry } from "../api";

type Obj = Record<string, unknown>;

const svc = (name: string, ports: Obj[] = [{ name: "http", port: 80 }], ns = "shop", spec: Obj = {}): Obj => ({
  metadata: { name, namespace: ns },
  spec: { ports, selector: { app: name }, ...spec },
});
const slice = (service: string, ready: boolean[], ns = "shop"): Obj => ({
  metadata: { name: `${service}-x`, namespace: ns, labels: { "kubernetes.io/service-name": service } },
  endpoints: ready.map((r, i) => ({ addresses: [`10.0.0.${i}`], conditions: { ready: r } })),
});
const ingress = (spec: Obj, ns = "shop", meta: Obj = {}): Obj => ({ metadata: { name: "web", namespace: ns, ...meta }, spec });
const rule = (service: string, port: Obj, path = "/", host = "shop.example.com"): Obj => ({
  host,
  http: { paths: [{ path, pathType: "Prefix", backend: { service: { name: service, port } } }] },
});
const cls = (name: string, isDefault = false): Obj => ({
  metadata: { name, annotations: isDefault ? { "ingressclass.kubernetes.io/is-default-class": "true" } : {} },
});

const base = { ingressClasses: [cls("nginx")], services: [svc("api")], endpointSlices: [slice("api", [true])], secrets: [] as Obj[] };
const kinds = (issues: { kind: string }[]) => issues.map((i) => i.kind);

describe("resolveIngressRoutes", () => {
  it("resolves a healthy host/path to its Service with no issues", () => {
    const [r] = resolveIngressRoutes({ ...base, ingresses: [ingress({ ingressClassName: "nginx", rules: [rule("api", { number: 80 })] })] });
    expect(r).toMatchObject({ routeKind: "Ingress", namespace: "shop", name: "web", issues: [] });
    expect(r?.paths).toEqual([{ host: "shop.example.com", path: "/", backend: "api:80", issues: [] }]);
    expect(isRouteBroken(r!)).toBe(false);
  });

  it("flags a backend Service that doesn't exist", () => {
    const [r] = resolveIngressRoutes({ ...base, ingresses: [ingress({ ingressClassName: "nginx", rules: [rule("apii", { number: 80 })] })] });
    expect(kinds(r!.paths[0]!.issues)).toEqual(["service-missing"]);
    expect(isRouteBroken(r!)).toBe(true);
  });

  it("flags a port the Service doesn't expose, by number or by name", () => {
    const byNum = resolveIngressRoutes({ ...base, ingresses: [ingress({ ingressClassName: "nginx", rules: [rule("api", { number: 8080 })] })] });
    expect(kinds(byNum[0]!.paths[0]!.issues)).toEqual(["port-missing"]);
    const byName = resolveIngressRoutes({ ...base, ingresses: [ingress({ ingressClassName: "nginx", rules: [rule("api", { name: "http" })] })] });
    expect(byName[0]!.paths[0]!.issues).toEqual([]);
  });

  it("flags a Service with no ready endpoints, but not one with no EndpointSlice data", () => {
    const notReady = resolveIngressRoutes({
      ...base,
      endpointSlices: [slice("api", [false, false])],
      ingresses: [ingress({ ingressClassName: "nginx", rules: [rule("api", { number: 80 })] })],
    });
    expect(kinds(notReady[0]!.paths[0]!.issues)).toEqual(["no-ready-endpoints"]);
    const unknown = resolveIngressRoutes({ ...base, endpointSlices: [], ingresses: [ingress({ ingressClassName: "nginx", rules: [rule("api", { number: 80 })] })] });
    expect(unknown[0]!.paths[0]!.issues).toEqual([]);
  });

  it("covers the default backend", () => {
    const [r] = resolveIngressRoutes({ ...base, ingresses: [ingress({ ingressClassName: "nginx", defaultBackend: { service: { name: "gone", port: { number: 80 } } } })] });
    expect(r?.paths).toEqual([{ host: "*", path: "(default backend)", backend: "gone:80", issues: [{ kind: "service-missing", service: "gone" }] }]);
  });

  it("flags an IngressClass that doesn't exist, and a missing class when there's no default", () => {
    const missing = resolveIngressRoutes({ ...base, ingresses: [ingress({ ingressClassName: "traefik", rules: [rule("api", { number: 80 })] })] });
    expect(missing[0]!.issues).toEqual([{ kind: "class-missing", className: "traefik" }]);
    const none = resolveIngressRoutes({ ...base, ingresses: [ingress({ rules: [rule("api", { number: 80 })] })] });
    expect(kinds(none[0]!.issues)).toEqual(["no-class"]);
    const withDefault = resolveIngressRoutes({ ...base, ingressClasses: [cls("nginx", true)], ingresses: [ingress({ rules: [rule("api", { number: 80 })] })] });
    expect(withDefault[0]!.issues).toEqual([]);
    const legacy = resolveIngressRoutes({
      ...base,
      ingresses: [ingress({ rules: [rule("api", { number: 80 })] }, "shop", { annotations: { "kubernetes.io/ingress.class": "nginx" } })],
    });
    expect(legacy[0]!.issues).toEqual([]);
  });

  it("flags a TLS Secret that doesn't exist in the Ingress's namespace", () => {
    const spec = { ingressClassName: "nginx", tls: [{ hosts: ["shop.example.com"], secretName: "shop-tls" }], rules: [rule("api", { number: 80 })] };
    const missing = resolveIngressRoutes({ ...base, ingresses: [ingress(spec)] });
    expect(missing[0]!.issues).toEqual([{ kind: "tls-secret-missing", secret: "shop-tls" }]);
    const present = resolveIngressRoutes({ ...base, secrets: [{ metadata: { name: "shop-tls", namespace: "shop" } }], ingresses: [ingress(spec)] });
    expect(present[0]!.issues).toEqual([]);
  });
});

describe("resolveHttpRoutes", () => {
  const route = (spec: Obj, status: Obj = {}): Obj => ({ metadata: { name: "web", namespace: "shop" }, spec, status });
  const gw = (name: string, ns = "infra"): Obj => ({ metadata: { name, namespace: ns } });
  const hbase = { gateways: [gw("public")], services: [svc("api")], endpointSlices: [slice("api", [true])] };

  it("resolves each rule's matches and backends", () => {
    const [r] = resolveHttpRoutes({
      ...hbase,
      httpRoutes: [
        route({
          parentRefs: [{ name: "public", namespace: "infra" }],
          hostnames: ["shop.example.com"],
          rules: [{ matches: [{ path: { type: "PathPrefix", value: "/api" } }], backendRefs: [{ name: "api", port: 80 }] }],
        }),
      ],
    });
    expect(r).toMatchObject({ routeKind: "HTTPRoute", issues: [] });
    expect(r?.paths).toEqual([{ host: "shop.example.com", path: "/api", backend: "api:80", issues: [] }]);
  });

  it("flags a parent Gateway that doesn't exist, defaulting its namespace to the route's", () => {
    const [r] = resolveHttpRoutes({ ...hbase, httpRoutes: [route({ parentRefs: [{ name: "public" }], rules: [{ backendRefs: [{ name: "api", port: 80 }] }] })] });
    expect(r?.issues).toEqual([{ kind: "gateway-missing", gateway: "shop/public" }]);
  });

  it("flags missing backends and ports like an Ingress", () => {
    const [r] = resolveHttpRoutes({
      ...hbase,
      httpRoutes: [route({ parentRefs: [{ name: "public", namespace: "infra" }], rules: [{ backendRefs: [{ name: "api", port: 9090 }, { name: "nope", port: 80 }] }] })],
    });
    expect(r?.paths.map((p) => kinds(p.issues))).toEqual([["port-missing"], ["service-missing"]]);
    expect(r?.paths[0]?.path).toBe("/");
  });

  it("surfaces False Accepted/ResolvedRefs conditions the controller reported", () => {
    const [r] = resolveHttpRoutes({
      ...hbase,
      httpRoutes: [
        route(
          { parentRefs: [{ name: "public", namespace: "infra" }], rules: [{ backendRefs: [{ name: "api", port: 80 }] }] },
          { parents: [{ conditions: [{ type: "Accepted", status: "True" }, { type: "ResolvedRefs", status: "False", reason: "RefNotPermitted", message: "no ReferenceGrant" }] }] },
        ),
      ],
    });
    expect(r?.issues).toEqual([{ kind: "status-condition", type: "ResolvedRefs", reason: "RefNotPermitted", message: "no ReferenceGrant" }]);
  });
});

describe("detectGatewayApi", () => {
  const crd = (group: string, resource: string, gvr: string) => ({ group, resource, gvr }) as CRDEntry;
  it("finds the HTTPRoute and Gateway GVRs when the Gateway API CRDs are installed", () => {
    expect(
      detectGatewayApi([
        crd("gateway.networking.k8s.io", "httproutes", "gateway.networking.k8s.io/v1/httproutes"),
        crd("gateway.networking.k8s.io", "gateways", "gateway.networking.k8s.io/v1/gateways"),
      ]),
    ).toEqual({ httpRouteGvr: "gateway.networking.k8s.io/v1/httproutes", gatewayGvr: "gateway.networking.k8s.io/v1/gateways" });
    expect(detectGatewayApi([])).toEqual({});
  });
});
