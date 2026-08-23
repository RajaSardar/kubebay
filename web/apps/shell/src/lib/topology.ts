export interface KMeta {
  name?: string;
  namespace?: string;
  labels?: Record<string, string>;
  ownerReferences?: { kind: string; name: string; uid?: string }[];
  creationTimestamp?: string;
  deletionTimestamp?: string;
}

export interface KObj {
  metadata?: KMeta;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

export type Health = "ok" | "warn" | "err" | "idle";

export interface TopoNode {
  id: string;
  kind: "deployment" | "statefulset" | "daemonset" | "replicaset" | "pod" | "service";
  name: string;
  health: Health;
  detail: string;
}

export interface GraphNode {
  id: string;
  type: "workload" | "pod" | "service" | "rs";
  position: { x: number; y: number };
  data: TopoNode;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
  style?: Record<string, unknown>;
}

const WORKLOAD_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet"]);

function podHealth(p: KObj): Health {
  const meta = p.metadata ?? {};
  const status = (p.status ?? {}) as Record<string, unknown>;
  const spec = (p.spec ?? {}) as Record<string, unknown>;
  if (meta.deletionTimestamp) return "warn";

  const containers = (spec.containers ?? []) as unknown[];
  const cs = (status.containerStatuses ?? []) as Record<string, unknown>[];
  for (const c of cs) {
    const waiting = ((c.state as Record<string, unknown>) ?? {}).waiting as Record<string, unknown> | undefined;
    const reason = waiting?.reason as string | undefined;
    if (reason && reason !== "ContainerCreating") return "err";
  }
  const phase = status.phase as string;
  const readyCount = cs.filter((c) => c.ready === true).length;
  if (phase === "Running" && containers.length > 0 && readyCount === containers.length) return "ok";
  if (phase === "Succeeded") return "idle";
  if (phase === "Failed") return "err";
  return "warn";
}

function workloadHealth(w: KObj): Health {
  const status = (w.status ?? {}) as Record<string, unknown>;
  const spec = (w.spec ?? {}) as Record<string, unknown>;
  const desired = Number((spec.replicas as number) ?? 1);
  const ready = Number((status.readyReplicas as number) ?? 0);
  if (ready >= desired && desired > 0) return "ok";
  if (ready === 0) return "err";
  return "warn";
}

function ownerRefOf(meta: KMeta | undefined, kinds: Set<string>): { kind: string; name: string } | null {
  for (const ref of meta?.ownerReferences ?? []) {
    if (kinds.has(ref.kind)) return { kind: ref.kind, name: ref.name };
  }
  return null;
}

export function buildTopology(
  pods: KObj[],
  replicaSets: KObj[],
  deployments: KObj[],
  statefulSets: KObj[],
  daemonSets: KObj[],
  services: KObj[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const rsByName = new Map<string, KObj>();
  for (const rs of replicaSets) rsByName.set(rs.metadata?.name ?? "", rs);

  interface Group {
    parentId: string | null;
    parent?: GraphNode;
    pods: { node: GraphNode; pod: KObj }[];
  }
  const groups = new Map<string, Group>();
  const standaloneGroup: Group = { parentId: null, pods: [] };

  const COL_WL = 300;
  const COL_POD = 640;
  const ROW_H = 78;

  function ensureWorkload(kind: string, w: KObj): Group {
    const name = w.metadata?.name ?? "";
    const id = `wl:${kind}:${name}`;
    let g = groups.get(id);
    if (!g) {
      g = { parentId: id, pods: [] };
      groups.set(id, g);
    }
    return g;
  }

  const healthColor: Record<Health, string> = {
    ok: "var(--kb-status-ok)",
    warn: "var(--kb-status-warn)",
    err: "var(--kb-status-err)",
    idle: "var(--kb-status-pending)",
  };

  const podNodes: GraphNode[] = [];
  const wlNodes: GraphNode[] = [];
  const rsNodes: GraphNode[] = [];

  for (const p of pods) {
    const pname = p.metadata?.name ?? "";
    const pid = `pod:${pname}`;
    const h = podHealth(p);
    const readyCs = ((p.status ?? {}).containerStatuses ?? []) as Record<string, unknown>[];
    const totalC = (((p.spec ?? {}).containers ?? []) as unknown[]).length || 1;
    const readyN = readyCs.filter((c) => c.ready === true).length;
    const node: GraphNode = {
      id: pid,
      type: "pod",
      position: { x: COL_POD, y: 0 },
      data: {
        id: pid,
        kind: "pod",
        name: pname,
        health: h,
        detail: `${readyN}/${totalC} · ${((p.status ?? {}).phase as string) ?? ""}`,
      },
    };
    podNodes.push(node);

    const rsRef = ownerRefOf(p.metadata, new Set(["ReplicaSet"]));
    const directWl = ownerRefOf(p.metadata, WORKLOAD_KINDS);
    let group: Group | null = null;

    if (directWl) {
      group = ensureWorkload(directWl.kind, { metadata: { name: directWl.name } });
    } else if (rsRef) {
      const rs = rsByName.get(rsRef.name);
      const depRef = rs ? ownerRefOf(rs.metadata, new Set(["Deployment"])) : null;
      if (depRef) {
        group = ensureWorkload("Deployment", { metadata: { name: depRef.name } });
      } else {
        const rid = `rs:${rsRef.name}`;
        let g2 = groups.get(rid);
        if (!g2) {
          const rnode: GraphNode = {
            id: rid,
            type: "rs",
            position: { x: COL_WL, y: 0 },
            data: {
              id: rid,
              kind: "replicaset",
              name: rsRef.name,
              health: h,
              detail: "ReplicaSet",
            },
          };
          g2 = { parentId: rid, parent: rnode, pods: [] };
          groups.set(rid, g2);
          rsNodes.push(rnode);
        }
        group = g2;
      }
    }
    (group ?? standaloneGroup).pods.push({ node, pod: p });
  }

  for (const d of deployments) ensureWorkload("Deployment", d).parent = workloadNode("Deployment", d);
  for (const s of statefulSets) ensureWorkload("StatefulSet", s).parent = workloadNode("StatefulSet", s);
  for (const ds of daemonSets) ensureWorkload("DaemonSet", ds).parent = workloadNode("DaemonSet", ds);

  function workloadNode(kind: string, w: KObj): GraphNode {
    const name = w.metadata?.name ?? "";
    const id = `wl:${kind}:${name}`;
    const desired = Number(((w.spec ?? {}).replicas as number) ?? "?");
    const ready = Number(((w.status ?? {}).readyReplicas as number) ?? 0);
    return {
      id,
      type: "workload",
      position: { x: COL_WL, y: 0 },
      data: {
        id,
        kind: kind.toLowerCase() as TopoNode["kind"],
        name,
        health: workloadHealth(w),
        detail: `${kind} · ${ready}/${desired} ready`,
      },
    };
  }

  const edges: GraphEdge[] = [];
  let y = 30;

  const ordered = [...groups.values()].filter((g) => g.parent || g.pods.length);
  for (const g of ordered) {
    if (!g.pods.length && !g.parent) continue;
    if (!g.pods.length && g.parent) continue;

    const firstY = y;
    for (const { node } of g.pods) {
      node.position.y = y;
      y += ROW_H;
    }

    if (g.parent) {
      g.parent.position.y = (firstY + y - ROW_H) / 2;
      wlNodes.push(g.parent);
      for (const { node } of g.pods) {
        edges.push({
          id: `${g.parentId}->${node.id}`,
          source: g.parentId!,
          target: node.id,
          style: { stroke: "var(--kb-border-strong)" },
        });
      }
    }
    y += 26;
  }
  if (standaloneGroup.pods.length) {
    for (const { node } of standaloneGroup.pods) {
      node.position.y = y;
      y += ROW_H;
    }
  }

  const svcNodes: GraphNode[] = [];
  services.forEach((svc, i) => {
    const name = svc.metadata?.name ?? "";
    const sid = `svc:${name}`;
    const selector = ((svc.spec ?? {}).selector ?? {}) as Record<string, string>;
    if (!selector || Object.keys(selector).length === 0) return;

    const matched = [...groups.values()]
      .flatMap((g) => g.pods)
      .filter(({ pod }) => {
        const labels = pod.metadata?.labels ?? {};
        return Object.entries(selector).every(([k, v]) => labels[k] === v);
      });

    const svcType = ((svc.spec ?? {}).type as string) ?? "ClusterIP";
    const portList = ((svc.spec ?? {}).ports ?? []) as Record<string, unknown>[];
    const firstPort = portList[0]?.port;
    const portStr = firstPort != null ? String(firstPort) : "";

    const node: GraphNode = {
      id: sid,
      type: "service",
      position: { x: 20, y: 40 + i * (ROW_H + 26) },
      data: {
        id: sid,
        kind: "service",
        name,
        health: matched.length ? "ok" : "warn",
        detail: `${svcType}${portStr ? ` :${portStr}` : ""} · ${matched.length} ep`,
      },
    };
    svcNodes.push(node);

    const parents = new Set(matched.map(({ node: pn }) => pn.id));
    const only = parents.size === 1 ? [...parents][0] : undefined;
    if (only) {
      edges.push({
        id: `${sid}->${only}`,
        source: sid,
        target: only,
        animated: true,
        style: { stroke: "var(--kb-accent)", strokeDasharray: "5 3" },
      });
    } else {
      for (const pid of parents) {
        edges.push({
          id: `${sid}->${pid}`,
          source: sid,
          target: pid,
          animated: true,
          style: { stroke: "var(--kb-accent)", strokeDasharray: "5 3" },
        });
      }
    }
  });

  void healthColor;
  return {
    nodes: [...svcNodes, ...wlNodes, ...rsNodes, ...podNodes],
    edges,
  };
}
