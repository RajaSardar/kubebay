import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge, EmptyState, InlineBanner, StatusDot } from "@kubebay/ui";
import { ForbiddenState } from "../components/ForbiddenState";
import { PageLoader } from "../components/PageLoader";
import { deniedStreams, listKinds } from "../lib/forbidden";
import { useResourceStream } from "../lib/useResourceStream";
import { crdApi, promApi } from "../lib/api";
import { ALL_NAMESPACES, ALL_NAMESPACES_BUDGET, buildAllNamespacesMap } from "../lib/serviceMapAll";
import { OBSERVED_PROBES, OBSERVED_SERIES_CAP, capSeries, observedEdges, observedEdgesAllNamespaces, type ProbeResult } from "../lib/observedTraffic";
import { buildServiceMap, detectMapCrds, filterEdges, visibleNodes, type MapEdge, type MapNode } from "../lib/serviceMap";
import type { KObj } from "../lib/topology";

const KIND_LABEL: Record<MapEdge["kind"], string> = {
  "routes-to": "routes to",
  serves: "serves",
  allowed: "allowed",
  references: "references",
  subset: "subset",
  traffic: "traffic",
};

function MapNodeView(props: NodeProps) {
  const kb = (props.data as unknown as { kb: MapNode }).kb;
  return (
    <>
      {kb.type === "group" ? (
        <div className="mono strong" style={{ fontSize: "var(--kb-text-sm)" }}>{kb.name}</div>
      ) : (
      <>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className={`topo-card${kb.type === "service" ? " topo-svc" : ""}`} title={kb.detail}>
        {kb.type === "workload" ? <StatusDot status={kb.health} /> : <span className="topo-kind">{kb.type === "ingress" ? "ing" : "svc"}</span>}
        <div style={{ minWidth: 0 }}>
          <div className="mono strong" style={{ fontSize: "var(--kb-text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {kb.name}
          </div>
          <div className="muted" style={{ fontSize: "var(--kb-text-2xs)" }}>{kb.detail}</div>
        </div>
      </div>
      </>
      )}
    </>
  );
}

const MAX_FINDINGS = 6;

const NODE_TYPES = { ingress: MapNodeView, service: MapNodeView, workload: MapNodeView, group: MapNodeView };

function edgeStyle(e: MapEdge): Record<string, unknown> {
  if (e.basis === "observed") return { stroke: "var(--kb-status-ok)", strokeWidth: 2 };
  if (e.kind === "allowed") return { stroke: "var(--kb-border-strong)", opacity: 0.55 };
  if (e.basis === "inferred") return { stroke: "var(--kb-status-warn)", strokeDasharray: "5 3" };
  return { stroke: "var(--kb-accent)" };
}

/** The Topology page's "Service map" view: who routes to, serves and is allowed to reach whom. */
export default function ServiceMapView({ cluster, namespace }: { cluster: string; namespace: string }) {
  const navigate = useNavigate();
  const all = namespace === ALL_NAMESPACES;
  // No ns means every namespace the identity may list; the engine subscribes per namespace it is allowed.
  const opts = { mode: "full" as const, ns: all ? undefined : [namespace] };
  const ingresses = useResourceStream(cluster, "networking.k8s.io/v1/ingresses", opts);
  const services = useResourceStream(cluster, "v1/services", opts);
  const slices = useResourceStream(cluster, "discovery.k8s.io/v1/endpointslices", opts);
  const pods = useResourceStream(cluster, "v1/pods", opts);
  const rss = useResourceStream(cluster, "apps/v1/replicasets", opts);
  const deps = useResourceStream(cluster, "apps/v1/deployments", opts);
  const stss = useResourceStream(cluster, "apps/v1/statefulsets", opts);
  const dss = useResourceStream(cluster, "apps/v1/daemonsets", opts);
  const netpols = useResourceStream(cluster, "networking.k8s.io/v1/networkpolicies", opts);

  // Gateway API and Istio kinds are followed only when discovery finds their CRDs.
  const crds = useQuery({ queryKey: ["crds", cluster], queryFn: () => crdApi.list(cluster), enabled: !!cluster, staleTime: 5 * 60_000, retry: false });
  const { gvrs } = useMemo(() => detectMapCrds(crds.data ?? []), [crds.data]);
  const optionalOpts = (gvr: string | undefined) => ({ ...opts, enabled: !!gvr });
  const gateways = useResourceStream(gvrs.gateways ? cluster : undefined, gvrs.gateways ?? "", optionalOpts(gvrs.gateways));
  const httpRoutes = useResourceStream(gvrs.httpRoutes ? cluster : undefined, gvrs.httpRoutes ?? "", optionalOpts(gvrs.httpRoutes));
  const grpcRoutes = useResourceStream(gvrs.grpcRoutes ? cluster : undefined, gvrs.grpcRoutes ?? "", optionalOpts(gvrs.grpcRoutes));
  const virtualServices = useResourceStream(gvrs.virtualServices ? cluster : undefined, gvrs.virtualServices ?? "", optionalOpts(gvrs.virtualServices));
  const destinationRules = useResourceStream(gvrs.destinationRules ? cluster : undefined, gvrs.destinationRules ?? "", optionalOpts(gvrs.destinationRules));
  // A ReferenceGrant lives in the namespace a route points into, so it is read from every namespace, and only when routes are followed.
  const grantsWanted = !!gvrs.referenceGrants && !!(gvrs.httpRoutes || gvrs.grpcRoutes);
  const referenceGrants = useResourceStream(grantsWanted ? cluster : undefined, gvrs.referenceGrants ?? "", { mode: "full", enabled: grantsWanted });
  const grantRows = grantsWanted && referenceGrants.synced && !referenceGrants.forbidden ? (referenceGrants.rows as KObj[]) : undefined;

  const streams = { ingresses, services, endpointslices: slices, pods, replicasets: rss, deployments: deps, statefulsets: stss, daemonsets: dss, networkpolicies: netpols };
  const optionalStreams = { gateways, httproutes: httpRoutes, grpcroutes: grpcRoutes, referencegrants: referenceGrants, virtualservices: virtualServices, destinationrules: destinationRules };
  const denied = deniedStreams({ ...streams, ...Object.fromEntries(Object.entries(optionalStreams).filter(([, v]) => v.forbidden)) });
  const ready = Object.values(streams).every((s) => s.synced || s.forbidden);

  const [showInferred, setShowInferred] = useState(true);
  const [showAllowed, setShowAllowed] = useState(true);
  const [showCross, setShowCross] = useState(true);

  const baseGraph = useMemo(() => {
    const objs = {
      ingresses: ingresses.rows as KObj[],
      services: services.rows as KObj[],
      slices: slices.rows as KObj[],
      pods: pods.rows as KObj[],
      replicaSets: rss.rows as KObj[],
      deployments: deps.rows as KObj[],
      statefulSets: stss.rows as KObj[],
      daemonSets: dss.rows as KObj[],
      networkPolicies: netpols.rows as KObj[],
      gvrs,
      gateways: gateways.rows as KObj[],
      httpRoutes: httpRoutes.rows as KObj[],
      grpcRoutes: grpcRoutes.rows as KObj[],
      virtualServices: virtualServices.rows as KObj[],
      destinationRules: destinationRules.rows as KObj[],
      referenceGrants: grantRows,
    };
    if (all) return buildAllNamespacesMap(objs, { budget: ALL_NAMESPACES_BUDGET });
    return { ...buildServiceMap({ namespace, ...objs }), truncated: false, total: 0 };
  }, [all, namespace, gvrs, ingresses.rows, services.rows, slices.rows, pods.rows, rss.rows, deps.rows, stss.rows, dss.rows, netpols.rows, gateways.rows, httpRoutes.rows, grpcRoutes.rows, virtualServices.rows, destinationRules.rows, grantRows]);

  // Observed traffic: only when a Prometheus is found, and only once asked for.
  // One namespace runs a namespace-scoped query per metric; All namespaces runs one capped cluster-wide query per metric.
  const [showObserved, setShowObserved] = useState(false);
  const prom = useQuery({ queryKey: ["prom-status", cluster], queryFn: () => promApi.status(cluster), enabled: !!cluster, staleTime: 60_000 });
  const promFound = !!prom.data && prom.data.source !== "none";
  const observed = useQuery({
    queryKey: ["service-map-observed", cluster, namespace],
    enabled: promFound && showObserved,
    retry: false,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ProbeResult[]> => {
      const out: ProbeResult[] = [];
      for (const probe of OBSERVED_PROBES) {
        const present = await promApi.query({ cluster, query: probe.presenceQuery });
        if (!present.some((x) => Number(x.value?.[1]) > 0)) continue;
        const query = all ? probe.clusterRateQuery(OBSERVED_SERIES_CAP) : probe.rateQuery(namespace);
        const samples = await promApi.query({ cluster, query });
        out.push({ probe, query, at: Date.now(), ...(all ? capSeries(samples, OBSERVED_SERIES_CAP) : { samples }) });
      }
      return out;
    },
  });
  const observedList = useMemo(
    () =>
      promFound && showObserved
        ? (observed.data ?? []).flatMap((r) => (all ? observedEdgesAllNamespaces(r, baseGraph.nodes) : observedEdges(r, namespace, baseGraph.nodes)))
        : [],
    [promFound, showObserved, observed.data, all, namespace, baseGraph.nodes],
  );
  const graph = baseGraph;

  const shownEdges = useMemo(
    () => filterEdges([...baseGraph.edges, ...observedList], { inferred: showInferred, allowed: showAllowed, crossNamespace: showCross }),
    [baseGraph.edges, observedList, showInferred, showAllowed, showCross],
  );

  const rfNodes = useMemo(
    () => visibleNodes(graph.nodes, shownEdges).map((n) => ({ id: n.id, type: n.type, position: n.position, data: { kb: n }, ...(n.type === "group" ? { selectable: false, draggable: false } : {}) })),
    [graph.nodes, shownEdges],
  );
  const rfEdges = useMemo(
    () =>
      shownEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label:
          e.basis === "observed"
            ? `traffic · observed · ${(e.rate ?? 0).toFixed(2)} req/s · ${new Date(e.observedAt ?? 0).toLocaleTimeString()}`
            : `${KIND_LABEL[e.kind]} · ${e.basis}${e.basis === "inferred" && e.evidence ? ` · ${e.evidence}` : ""}`,
        animated: false,
        style: edgeStyle(e),
      })),
    [shownEdges],
  );

  const onNodeClick = useCallback(
    (_: unknown, node: { id: string }) => {
      const hit = graph.nodes.find((x) => x.id === node.id);
      const ref = hit?.type === "group" ? undefined : hit?.ref;
      if (ref) navigate(`/detail/${ref.slug}/${ref.ns || "_"}/${ref.name}`);
    },
    [graph.nodes, navigate],
  );

  const legend = (
    <div className="toolbar">
      <Badge tone="ok" title="An object states it: an Ingress or Gateway API route backend, an Istio VirtualService, an EndpointSlice, a NetworkPolicy.">declared</Badge>
      <Badge tone="warn" title="A heuristic: a Service selector with no EndpointSlice, or a host named in an env var. The edge's label carries the evidence.">inferred</Badge>
      <span className="muted small">No live traffic unless you tick observed traffic: lines are set-up paths, not requests.</span>
      {promFound && (
        <label className="ctl" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={showObserved} onChange={(e) => setShowObserved(e.target.checked)} />
          observed traffic (Prometheus)
        </label>
      )}
      <label className="ctl" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={showInferred} onChange={(e) => setShowInferred(e.target.checked)} />
        inferred edges
      </label>
      <label className="ctl" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={showAllowed} onChange={(e) => setShowAllowed(e.target.checked)} />
        allowed paths (NetworkPolicy)
      </label>
      <label className="ctl" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={showCross} onChange={(e) => setShowCross(e.target.checked)} />
        other namespaces
      </label>
    </div>
  );

  if (graph.nodes.length === 0) {
    if (denied.length > 0) return <ForbiddenState denied={denied} />;
    if (!ready) return <PageLoader message={`Mapping services in ${namespace}...`} />;
    return (
      <EmptyState className="topo-canvas topo-canvas-empty">
        <p>Nothing to map in "{namespace}".</p>
        <p className="muted small">It has no Services, Ingresses or workloads. Pick another namespace above.</p>
      </EmptyState>
    );
  }

  return (
    <>
      {legend}
      {baseGraph.truncated && (
        <InlineBanner>
          Showing the first {ALL_NAMESPACES_BUDGET} of {baseGraph.total} nodes, in namespace order. Narrow by namespace to see the rest.
          {showObserved && promFound && " Observed traffic is drawn only between nodes shown."}
        </InlineBanner>
      )}
      {showObserved &&
        promFound &&
        (observed.data ?? [])
          .filter((r) => r.truncated)
          .map((r) => (
            <InlineBanner key={`cap:${r.probe.metric}`}>
              Showing the top {OBSERVED_SERIES_CAP} series of {r.probe.metric} by request rate; quieter ones are not drawn. Narrow by namespace to see them all.
            </InlineBanner>
          ))}
      {showObserved && promFound && observed.isError && <InlineBanner>Could not read traffic from Prometheus: {(observed.error as Error).message}</InlineBanner>}
      {showObserved && promFound && observed.data && observed.data.length === 0 && (
        <InlineBanner>No traffic metrics found. Kubebay looks for istio_requests_total and nginx_ingress_controller_requests in this cluster's Prometheus and draws nothing else.</InlineBanner>
      )}
      {showObserved && observed.data && observed.data.length > 0 && (
        <div className="muted small">
          {observed.data.map((r) => (
            <div key={r.probe.metric} className="mono">
              observed from {r.probe.metric} at {new Date(r.at).toLocaleTimeString()}: {r.query}
            </div>
          ))}
        </div>
      )}
      {graph.findings.length > 0 && (
        <div className="toolbar" aria-label="findings">
          {graph.findings.slice(0, MAX_FINDINGS).map((f) => (
            <Badge key={`${f.kind}:${f.nodeId}`} tone={f.kind === "missing-service" ? "err" : "warn"} title={f.text}>
              {f.text}
            </Badge>
          ))}
          {graph.findings.length > MAX_FINDINGS && <span className="muted small">+{graph.findings.length - MAX_FINDINGS} more</span>}
        </div>
      )}
      {denied.length > 0 && (
        <InlineBanner>
          You can't list {listKinds(denied.map((d) => d.what))} here, so edges that depend on them are missing from this map.
        </InlineBanner>
      )}
      <div className="topo-canvas">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--kb-border-strong)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </>
  );
}
