import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge, EmptyState, InlineBanner, StatusDot } from "@kubebay/ui";
import { ForbiddenState } from "../components/ForbiddenState";
import { PageLoader } from "../components/PageLoader";
import { deniedStreams, listKinds } from "../lib/forbidden";
import { useResourceStream } from "../lib/useResourceStream";
import { buildServiceMap, filterEdges, type MapEdge, type MapNode } from "../lib/serviceMap";
import type { KObj } from "../lib/topology";

const KIND_LABEL: Record<MapEdge["kind"], string> = {
  "routes-to": "routes to",
  serves: "serves",
  allowed: "allowed",
  references: "references",
};

function MapNodeView(props: NodeProps) {
  const kb = (props.data as unknown as { kb: MapNode }).kb;
  return (
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
  );
}

const NODE_TYPES = { ingress: MapNodeView, service: MapNodeView, workload: MapNodeView };

function edgeStyle(e: MapEdge): Record<string, unknown> {
  if (e.kind === "allowed") return { stroke: "var(--kb-border-strong)", opacity: 0.55 };
  if (e.basis === "inferred") return { stroke: "var(--kb-status-warn)", strokeDasharray: "5 3" };
  return { stroke: "var(--kb-accent)" };
}

/** The Topology page's "Service map" view: who routes to, serves and is allowed to reach whom. */
export default function ServiceMapView({ cluster, namespace }: { cluster: string; namespace: string }) {
  const navigate = useNavigate();
  const opts = { mode: "full" as const, ns: [namespace] };
  const ingresses = useResourceStream(cluster, "networking.k8s.io/v1/ingresses", opts);
  const services = useResourceStream(cluster, "v1/services", opts);
  const slices = useResourceStream(cluster, "discovery.k8s.io/v1/endpointslices", opts);
  const pods = useResourceStream(cluster, "v1/pods", opts);
  const rss = useResourceStream(cluster, "apps/v1/replicasets", opts);
  const deps = useResourceStream(cluster, "apps/v1/deployments", opts);
  const stss = useResourceStream(cluster, "apps/v1/statefulsets", opts);
  const dss = useResourceStream(cluster, "apps/v1/daemonsets", opts);
  const netpols = useResourceStream(cluster, "networking.k8s.io/v1/networkpolicies", opts);

  const streams = { ingresses, services, endpointslices: slices, pods, replicasets: rss, deployments: deps, statefulsets: stss, daemonsets: dss, networkpolicies: netpols };
  const denied = deniedStreams(streams);
  const ready = Object.values(streams).every((s) => s.synced || s.forbidden);

  const [showInferred, setShowInferred] = useState(true);
  const [showAllowed, setShowAllowed] = useState(true);

  const graph = useMemo(
    () =>
      buildServiceMap({
        namespace,
        ingresses: ingresses.rows as KObj[],
        services: services.rows as KObj[],
        slices: slices.rows as KObj[],
        pods: pods.rows as KObj[],
        replicaSets: rss.rows as KObj[],
        deployments: deps.rows as KObj[],
        statefulSets: stss.rows as KObj[],
        daemonSets: dss.rows as KObj[],
        networkPolicies: netpols.rows as KObj[],
      }),
    [namespace, ingresses.rows, services.rows, slices.rows, pods.rows, rss.rows, deps.rows, stss.rows, dss.rows, netpols.rows],
  );

  const rfNodes = useMemo(
    () => graph.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: { kb: n } })),
    [graph.nodes],
  );
  const rfEdges = useMemo(
    () =>
      filterEdges(graph.edges, { inferred: showInferred, allowed: showAllowed }).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: `${KIND_LABEL[e.kind]} · ${e.basis}${e.basis === "inferred" && e.evidence ? ` · ${e.evidence}` : ""}`,
        animated: false,
        style: edgeStyle(e),
      })),
    [graph.edges, showInferred, showAllowed],
  );

  const onNodeClick = useCallback(
    (_: unknown, node: { id: string }) => {
      const ref = graph.nodes.find((n) => n.id === node.id)?.ref;
      if (ref) navigate(`/detail/${ref.slug}/${ref.ns || "_"}/${ref.name}`);
    },
    [graph.nodes, navigate],
  );

  const legend = (
    <div className="toolbar">
      <Badge tone="ok" title="An object states it: an Ingress backend, an EndpointSlice, a NetworkPolicy.">declared</Badge>
      <Badge tone="warn" title="A heuristic: a Service selector with no EndpointSlice, or a host named in an env var. The edge's label carries the evidence.">inferred</Badge>
      <span className="muted small">No live traffic: nothing here is observed.</span>
      <label className="ctl" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={showInferred} onChange={(e) => setShowInferred(e.target.checked)} />
        inferred edges
      </label>
      <label className="ctl" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={showAllowed} onChange={(e) => setShowAllowed(e.target.checked)} />
        allowed paths (NetworkPolicy)
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
