import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@kubebay/ui";
import { api } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { buildTopology, type Health, type KObj, type TopoNode } from "../lib/topology";
import PodPanel from "./PodPanel";

interface FlowData {
  kb: TopoNode;
}

function Shell({ kb }: { kb: TopoNode }) {
  return (
    <div
      className="topo-card"
      title={kb.detail}
    >
      <StatusDotDot health={kb.health} />
      <div style={{ minWidth: 0 }}>
        <div className="mono strong" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {kb.name}
        </div>
        <div className="muted" style={{ fontSize: 10.5 }}>{kb.detail}</div>
      </div>
    </div>
  );
}

function StatusDotDot({ health }: { health: Health }) {
  const color =
    health === "ok" ? "var(--kb-status-ok)" : health === "err" ? "var(--kb-status-err)" : health === "warn" ? "var(--kb-status-warn)" : "var(--kb-status-pending)";
  return <span className="kb-dot" style={{ background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)` }} />;
}

function WorkloadNode(props: NodeProps) {
  const { kb } = props.data as unknown as FlowData;
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <Shell kb={kb} />
    </>
  );
}

function PodNodeView(props: NodeProps) {
  const { kb } = props.data as unknown as FlowData;
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <Shell kb={kb} />
    </>
  );
}

function ServiceNodeView(props: NodeProps) {
  const { kb } = props.data as unknown as FlowData;
  return (
    <>
      <Handle type="source" position={Position.Right} />
      <div className="topo-card topo-svc">
        <span className="topo-kind">svc</span>
        <div style={{ minWidth: 0 }}>
          <div className="mono strong" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {kb.name}
          </div>
          <div className="muted" style={{ fontSize: 10.5 }}>{kb.detail}</div>
        </div>
      </div>
    </>
  );
}

function RsNodeView(props: NodeProps) {
  const { kb } = props.data as unknown as FlowData;
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="topo-card topo-rs">
        <span className="topo-kind">rs</span>
        <div className="mono muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {kb.name}
        </div>
      </div>
    </>
  );
}

const NODE_TYPES = {
  workload: WorkloadNode,
  pod: PodNodeView,
  service: ServiceNodeView,
  rs: RsNodeView,
};

export default function Topology() {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const list = clusters.data ?? [];
  const effectiveCluster = list.find((c) => c.status === "connected")?.id || list[0]?.id || "";

  const namespaces = useResourceStream(effectiveCluster || undefined, "v1/namespaces", { mode: "metadata" });
  const nsOptions = useMemo(() => {
    const names = namespaces.rows
      .map((r) => (r as KObj).metadata?.name)
      .filter((n): n is string => !!n)
      .sort();
    return names.length ? names : ["default"];
  }, [namespaces.rows]);

  const [ns, setNs] = useState("default");
  const effectiveNs = nsOptions.includes(ns) ? ns : nsOptions[0] ?? "default";

  const pods = useResourceStream(effectiveCluster || undefined, "v1/pods", { mode: "full", ns: [effectiveNs] });
  const rss = useResourceStream(effectiveCluster || undefined, "apps/v1/replicasets", { mode: "full", ns: [effectiveNs] });
  const deps = useResourceStream(effectiveCluster || undefined, "apps/v1/deployments", { mode: "full", ns: [effectiveNs] });
  const stss = useResourceStream(effectiveCluster || undefined, "apps/v1/statefulsets", { mode: "full", ns: [effectiveNs] });
  const dss = useResourceStream(effectiveCluster || undefined, "apps/v1/daemonsets", { mode: "full", ns: [effectiveNs] });
  const svcs = useResourceStream(effectiveCluster || undefined, "v1/services", { mode: "full", ns: [effectiveNs] });

  const ready =
    pods.synced && rss.synced && deps.synced && stss.synced && dss.synced && svcs.synced;

  const graph = useMemo(
    () =>
      buildTopology(
        pods.rows as KObj[],
        rss.rows as KObj[],
        deps.rows as KObj[],
        stss.rows as KObj[],
        dss.rows as KObj[],
        svcs.rows as KObj[],
      ),
    [pods.rows, rss.rows, deps.rows, stss.rows, dss.rows, svcs.rows],
  );

  const rfNodes = useMemo(
    () => graph.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: { kb: n.data } })),
    [graph.nodes],
  );

  const [selectedPod, setSelectedPod] = useState<string | null>(null);

  const onNodeClick = useCallback(
    (_: unknown, node: { id: string }) => {
      if (node.id.startsWith("pod:")) setSelectedPod(node.id.slice(4));
      else setSelectedPod(null);
    },
    [],
  );

  return (
    <div className="page page-full">
      <div className="page-header">
        <h2>
          Topology
          {ready && <span className="live-pill">● live</span>}
        </h2>
        <Badge>{graph.nodes.length} objects</Badge>
      </div>

      <div className="toolbar">
        <select className="toolbar-select" value={effectiveCluster} onChange={() => undefined} aria-label="cluster">
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}
            </option>
          ))}
        </select>
        <select className="toolbar-select" value={effectiveNs} onChange={(e) => setNs(e.target.value)} aria-label="namespace">
          {nsOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {selectedPod && <Badge tone="ok">{selectedPod}</Badge>}
      </div>

      {!effectiveCluster ? (
        <p className="muted">Waiting for cluster…</p>
      ) : !ready ? (
        <div className="topo-canvas empty-state">
          <p>Mapping the bay…</p>
          <p className="muted small">Syncing workloads, pods and services for “{effectiveNs}”.</p>
        </div>
      ) : graph.nodes.length === 0 ? (
        <div className="topo-canvas empty-state">
          <p>Nothing running in “{effectiveNs}”.</p>
          <p className="muted small">Pick another namespace above.</p>
        </div>
      ) : (
        <div className="topo-canvas">
          <ReactFlow
            nodes={rfNodes}
            edges={graph.edges}
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
      )}

      {selectedPod && (
        <PodPanel
          pod={{
            cluster: effectiveCluster,
            namespace: effectiveNs,
            pod: selectedPod,
            containers: [""],
          }}
          onClose={() => setSelectedPod(null)}
        />
      )}
    </div>
  );
}
