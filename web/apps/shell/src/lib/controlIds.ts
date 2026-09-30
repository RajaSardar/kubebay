import type { RBACFinding } from "./api";

export interface ControlRef {
  framework: "CIS" | "ATT&CK";
  id: string;
  name: string;
}

/**
 * Roadmap Tier 1 #11: framework control IDs on findings Kubebay already
 * surfaces — labels only, no new detector and no compliance verdict. CIS
 * section numbers are the CIS Kubernetes Benchmark v1.9 "Policies" chapter;
 * ATT&CK IDs are from MITRE's Containers matrix. A finding is only tagged
 * where the control plainly describes it; anything looser stays untagged.
 */
const CIS = {
  clusterAdmin: { framework: "CIS", id: "5.1.1", name: "Ensure that the cluster-admin role is only used where required" },
  secretAccess: { framework: "CIS", id: "5.1.2", name: "Minimize access to secrets" },
  wildcards: { framework: "CIS", id: "5.1.3", name: "Minimize wildcard use in Roles and ClusterRoles" },
  defaultSa: { framework: "CIS", id: "5.1.5", name: "Ensure that default service accounts are not actively used" },
  saTokenMount: { framework: "CIS", id: "5.1.6", name: "Ensure that Service Account Tokens are only mounted where necessary" },
  escalation: { framework: "CIS", id: "5.1.8", name: "Limit use of the Bind, Impersonate and Escalate permissions" },
  netpol: { framework: "CIS", id: "5.3.2", name: "Ensure that all Namespaces have Network Policies defined" },
  secretFiles: { framework: "CIS", id: "5.4.1", name: "Prefer using Secrets as files over Secrets as environment variables" },
  imageProvenance: { framework: "CIS", id: "5.5.1", name: "Configure Image Provenance using ImagePolicyWebhook admission controller" },
} satisfies Record<string, ControlRef>;

const ATTACK = {
  stealToken: { framework: "ATT&CK", id: "T1528", name: "Steal Application Access Token" },
  implantImage: { framework: "ATT&CK", id: "T1525", name: "Implant Internal Image" },
  containerApiCreds: { framework: "ATT&CK", id: "T1552.007", name: "Unsecured Credentials: Container API" },
  containerAdminCmd: { framework: "ATT&CK", id: "T1609", name: "Container Administration Command" },
} satisfies Record<string, ControlRef>;

export type DetectorKey = "secret-env" | "netpol-gap" | "default-sa-automount" | "unverified-images";

export const CONTROLS: Record<DetectorKey, ControlRef[]> = {
  "secret-env": [CIS.secretFiles],
  "netpol-gap": [CIS.netpol],
  "default-sa-automount": [CIS.defaultSa, CIS.saTokenMount, ATTACK.stealToken],
  "unverified-images": [CIS.imageProvenance, ATTACK.implantImage],
};

export function controlsFor(detector: DetectorKey): ControlRef[] {
  return CONTROLS[detector];
}

/**
 * The engine's RBAC advisor (engine/internal/httpapi/rbacadvisor.go) sends
 * findings by title, so they're matched on it here. A title this doesn't
 * recognise gets no tags rather than a guessed one.
 */
export function rbacFindingControls(f: Pick<RBACFinding, "title">): ControlRef[] {
  const t = f.title;
  if (t === "Bound to the built-in cluster-admin role") return [CIS.clusterAdmin];
  if (t === "Full cluster-admin-equivalent access") return [CIS.clusterAdmin, CIS.wildcards];
  if (t.startsWith("Wildcard ")) return [CIS.wildcards];
  if (t.startsWith("Privilege-escalation verb")) return [CIS.escalation];
  if (t === "Cluster-wide Secret read access") return [CIS.secretAccess, ATTACK.containerApiCreds];
  if (t === "Cluster-wide pod exec access") return [ATTACK.containerAdminCmd];
  return [];
}
