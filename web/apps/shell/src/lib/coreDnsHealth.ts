function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown, d: number): number {
  return typeof v === "number" ? v : d;
}

export type CoreDnsFindingKind =
  | "single-replica"
  | "not-ready"
  | "same-node"
  | "corefile-missing-loop"
  | "corefile-missing-health"
  | "corefile-missing-ready"
  | "corefile-missing-cache";

export interface CoreDnsFinding {
  kind: CoreDnsFindingKind;
  detail: string;
}

export interface CoreDnsReport {
  present: boolean;
  corefileChecked: boolean;
  findings: CoreDnsFinding[];
}

// Both CoreDNS and the legacy kube-dns carry this label, by long-standing convention.
const DNS_LABEL: [string, string] = ["k8s-app", "kube-dns"];

const REQUIRED_PLUGINS: { plugin: string; kind: CoreDnsFindingKind; why: string }[] = [
  { plugin: "loop", kind: "corefile-missing-loop", why: "without it a forwarding loop crash-loops every CoreDNS pod" },
  { plugin: "health", kind: "corefile-missing-health", why: "the liveness probe has nothing to hit" },
  { plugin: "ready", kind: "corefile-missing-ready", why: "pods report Ready before they can serve" },
  { plugin: "cache", kind: "corefile-missing-cache", why: "every lookup goes upstream" },
];

function isDns(obj: Record<string, unknown>): boolean {
  const meta = rec(obj.metadata);
  return str(meta.namespace) === "kube-system" && rec(meta.labels)[DNS_LABEL[0]] === DNS_LABEL[1];
}

function hasPlugin(corefile: string, plugin: string): boolean {
  // A directive is a plugin name at the start of a line, followed by space, `{`, or end of line.
  return new RegExp(`^\\s*${plugin}(\\s|\\{|$)`, "m").test(corefile);
}

/**
 * Backlog #31: cluster DNS is one Deployment every workload depends on, and
 * its common failure modes are all visible from objects Kubebay can read --
 * too few replicas, replicas not ready, replicas packed onto one node, and
 * a Corefile missing the plugins the upstream default ships with.
 */
export function checkCoreDns(
  deployments: Record<string, unknown>[],
  pods: Record<string, unknown>[],
  configMaps: Record<string, unknown>[],
): CoreDnsReport {
  const dep = deployments.find(isDns);
  if (!dep) return { present: false, corefileChecked: false, findings: [] };

  const findings: CoreDnsFinding[] = [];
  const desired = num(rec(dep.spec).replicas, 1);
  const ready = num(rec(dep.status).readyReplicas, 0);

  if (desired < 2) {
    findings.push({ kind: "single-replica", detail: `${desired} replica — every DNS lookup in the cluster depends on one pod.` });
  }
  if (ready < desired) {
    findings.push({ kind: "not-ready", detail: `${ready} of ${desired} replicas ready.` });
  }

  const running = pods.filter((p) => isDns(p) && str(rec(p.status).phase) === "Running");
  const nodes = new Set(running.map((p) => str(rec(p.spec).nodeName)).filter(Boolean));
  if (running.length >= 2 && nodes.size === 1) {
    findings.push({ kind: "same-node", detail: `All ${running.length} replicas are on ${[...nodes][0]} — one node failure takes out cluster DNS.` });
  }

  const cm = configMaps.find((c) => {
    const meta = rec(c.metadata);
    return str(meta.namespace) === "kube-system" && str(meta.name) === "coredns";
  });
  const corefile = str(rec(cm?.data).Corefile);
  if (corefile) {
    for (const { plugin, kind, why } of REQUIRED_PLUGINS) {
      if (!hasPlugin(corefile, plugin)) findings.push({ kind, detail: `Corefile has no \`${plugin}\` — ${why}.` });
    }
  }

  return { present: true, corefileChecked: !!corefile, findings };
}
