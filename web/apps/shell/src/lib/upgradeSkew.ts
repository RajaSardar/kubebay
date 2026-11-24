// Backlog #80: version skew between the API server, each node's kubelet and
// kube-proxy, and the version the user is planning to upgrade to.
//
// Policy, from https://kubernetes.io/releases/version-skew-policy/ (as of
// Kubernetes 1.28 and later):
//   - kubelet must not be newer than kube-apiserver, and may be up to THREE
//     minor versions older (it was two before 1.28).
//   - kube-proxy must not be newer than kube-apiserver, and may be up to
//     THREE minor versions older.
// Patch versions never matter. Node status reports kubeProxyVersion as an
// empty string on recent versions, in which case there is nothing to check.
type Obj = Record<string, unknown>;
const rec = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const MAX_MINORS_OLDER = 3;

export type SkewKind = "kubelet-too-old" | "kubelet-newer" | "kube-proxy-too-old" | "kube-proxy-newer" | "mixed-minors";

export interface SkewFinding {
  kind: SkewKind;
  node?: string;
  component?: "kubelet" | "kube-proxy";
  /** True when the problem only appears once the control plane reaches the target version. */
  afterTarget: boolean;
  detail: string;
  why: string;
}

function minorOf(v: string): number | undefined {
  const m = /^v?1\.(\d+)/.exec(v.trim());
  return m ? parseInt(m[1]!, 10) : undefined;
}

export function versionSkewFindings(serverVersion: string, nodes: Obj[], targetVersion?: string): SkewFinding[] {
  const serverMinor = minorOf(serverVersion);
  if (serverMinor === undefined) return [];
  const targetMinor = targetVersion ? minorOf(targetVersion) : undefined;
  const refMinor = targetMinor ?? serverMinor;
  const afterTarget = targetMinor !== undefined && targetMinor !== serverMinor;
  const refLabel = afterTarget ? `the target 1.${refMinor}` : `the API server's 1.${refMinor}`;
  const out: SkewFinding[] = [];
  const kubeletMinors = new Map<number, string[]>();

  for (const n of nodes) {
    const name = str(rec(n.metadata).name);
    const info = rec(rec(n.status).nodeInfo);
    for (const component of ["kubelet", "kube-proxy"] as const) {
      const version = str(component === "kubelet" ? info.kubeletVersion : info.kubeProxyVersion);
      const minor = minorOf(version);
      if (minor === undefined) continue;
      if (component === "kubelet") kubeletMinors.set(minor, [...(kubeletMinors.get(minor) ?? []), name]);
      const prefix = component === "kubelet" ? "kubelet" : "kube-proxy";
      if (minor > refMinor) {
        out.push({
          kind: component === "kubelet" ? "kubelet-newer" : "kube-proxy-newer",
          node: name,
          component,
          afterTarget,
          detail: `${name} runs ${prefix} ${version}, newer than ${refLabel}.`,
          why: `${prefix} must never be newer than the API server; upgrade the control plane first, or do not upgrade this node ahead of it.`,
        });
      } else if (refMinor - minor > MAX_MINORS_OLDER) {
        out.push({
          kind: component === "kubelet" ? "kubelet-too-old" : "kube-proxy-too-old",
          node: name,
          component,
          afterTarget,
          detail: `${name} runs ${prefix} ${version}, ${refMinor - minor} minor versions behind ${refLabel}.`,
          why: `Kubernetes supports ${prefix} at most ${MAX_MINORS_OLDER} minor versions older than the API server; beyond that the node may stop registering or running pods correctly. Upgrade or replace the node first.`,
        });
      }
    }
  }

  if (kubeletMinors.size > 1) {
    const list = [...kubeletMinors.entries()].sort((a, b) => a[0] - b[0]).map(([m, ns]) => `1.${m} (${ns.length})`);
    out.push({
      kind: "mixed-minors",
      afterTarget: false,
      detail: `Nodes run different kubelet minors: ${list.join(", ")}.`,
      why: "A half-finished node upgrade makes the next control-plane upgrade harder to reason about, and the oldest nodes are the first to fall out of the skew window.",
    });
  }
  return out;
}
