import { matchesSelector, type LabelSelector } from "./labelSelector";

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

export type CheckStatus = "pass" | "fail" | "unknown" | "ignored";
export type CheckGroup = "Reliability" | "Security" | "Disaster recovery" | "Platform";

export interface InstallSteps {
  /** The tool's name, for the disclosure heading. */
  tool: string;
  /** Shown as text only. Kubebay never runs these. */
  commands: string[];
  /** The official instructions. */
  docsUrl: string;
}

export type Severity = "Critical" | "High" | "Medium" | "Low";
export const SEVERITIES: Severity[] = ["Critical", "High", "Medium", "Low"];

export interface Lesson {
  /** A short plain-language explanation. */
  text: string;
  /** The official documentation, shown as text. */
  docsUrl: string;
}

export interface BestPracticeCheck {
  id: string;
  severity: Severity;
  learn: Lesson;
  group: CheckGroup;
  title: string;
  status: CheckStatus;
  /** What was found, in one line. */
  detail: string;
  /** Why the check matters, in one line. */
  why: string;
  /** Up to three things that failed, "ns/name". */
  offenders?: string[];
  /** Every thing that failed; what a namespace exception filters. */
  allOffenders?: string[];
  /** Namespaces the failures sit in, for "Ignore for namespace X". Absent for cluster-wide objects. */
  namespaces?: string[];
  /** A CIS Kubernetes Benchmark control id, as a reference only. Absent where no mapping is well known. */
  reference?: string;
  /** The user's exceptions that applied, with their reasons. */
  exceptions?: { namespace?: string; reason: string }[];
  /** The Kubebay route that works with the tool or the resource. */
  link?: string;
  linkLabel?: string;
  /** Only on a tool that isn't detected. */
  install?: InstallSteps;
}

/** undefined means the app couldn't read it (not synced yet, or RBAC forbids it). */
export interface BestPracticesInput {
  deployments: Obj[] | undefined;
  statefulsets: Obj[] | undefined;
  pdbs: Obj[] | undefined;
  networkPolicies: Obj[] | undefined;
  namespaces: Obj[] | undefined;
  ingressClasses: Obj[] | undefined;
  /** API groups the server serves, from discovery. */
  apiGroups: string[] | undefined;
  /** The inputs below are optional: leaving one out means unreadable, so unknown. */
  services?: Obj[] | undefined;
  pvcs?: Obj[] | undefined;
  nodes?: Obj[] | undefined;
  /** cert-manager Certificates; pass [] when cert-manager isn't installed. */
  certificates?: Obj[] | undefined;
  hpas?: Obj[] | undefined;
  /** Velero Schedules; pass [] when Velero isn't installed. */
  veleroSchedules?: Obj[] | undefined;
  /** DaemonSets, CronJobs and Pods are optional; left out means not covered (see workloadCoverage). */
  daemonsets?: Obj[] | undefined;
  cronjobs?: Obj[] | undefined;
  pods?: Obj[] | undefined;
  /** Epoch ms, for certificate expiry. Defaults to now. */
  now?: number;
}

type Raw = Omit<BestPracticeCheck, "severity" | "learn" | "reference" | "namespaces" | "exceptions">;

const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease"]);
const MAX_OFFENDERS = 3;

interface Workload {
  ns: string;
  name: string;
  replicas: number;
  labels: Record<string, string>;
  containers: Obj[];
  pod: Obj;
}

type WorkloadKind = "deployment" | "statefulset" | "daemonset" | "cronjob" | "pod";

function toWorkloads(items: Obj[], kind: WorkloadKind = "deployment"): Workload[] {
  const out: Workload[] = [];
  for (const o of items) {
    const meta = rec(o.metadata);
    const ns = str(meta.namespace);
    if (SYSTEM_NAMESPACES.has(ns)) continue;
    const spec = rec(o.spec);
    let tpl: Obj;
    if (kind === "pod") {
      // A pod a controller owns is covered through its controller's template.
      if (arr(meta.ownerReferences).some((r) => rec(r).controller === true)) continue;
      tpl = { metadata: meta, spec };
    } else if (kind === "cronjob") tpl = rec(rec(rec(spec.jobTemplate).spec).template);
    else tpl = rec(spec.template);
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec(rec(tpl.metadata).labels))) if (typeof v === "string") labels[k] = v;
    out.push({
      ns,
      name: str(meta.name),
      replicas: typeof spec.replicas === "number" ? spec.replicas : 1,
      labels,
      containers: arr(rec(tpl.spec).containers).map(rec),
      pod: rec(tpl.spec),
    });
  }
  return out;
}

export interface CoverageItem {
  kind: string;
  /** Workloads read, system namespaces and controller-owned pods left out. */
  count: number;
  /** False when the app couldn't read this kind, so nothing of it was checked. */
  read: boolean;
}

/** What the workload checks looked at, so a pass is never read as wider than it is. */
export function workloadCoverage(input: BestPracticesInput): CoverageItem[] {
  const kinds: [string, Obj[] | undefined, WorkloadKind][] = [
    ["Deployments", input.deployments, "deployment"],
    ["StatefulSets", input.statefulsets, "statefulset"],
    ["DaemonSets", input.daemonsets, "daemonset"],
    ["CronJobs", input.cronjobs, "cronjob"],
    ["bare Pods", input.pods, "pod"],
  ];
  return kinds.map(([kind, items, k]) => ({ kind, count: items ? toWorkloads(items, k).length : 0, read: !!items }));
}

function name(w: Workload): string {
  return `${w.ns}/${w.name}`;
}

function listResult(
  base: Omit<Raw, "status" | "detail" | "offenders">,
  offenders: string[],
  noun: string,
  passDetail: string,
  link?: Pick<Raw, "link" | "linkLabel">,
): Raw {
  if (offenders.length === 0) return { ...base, status: "pass", detail: passDetail };
  return {
    ...base,
    ...link,
    status: "fail",
    detail: `${offenders.length} ${noun}`,
    offenders: offenders.slice(0, MAX_OFFENDERS),
    allOffenders: offenders,
  };
}

const UNKNOWN = (base: Omit<Raw, "status" | "detail">, what: string): Raw => ({
  ...base,
  status: "unknown",
  detail: `Can't read ${what}, so this can't be checked.`,
});

interface ToolSpec {
  id: string;
  group: CheckGroup;
  title: string;
  why: string;
  groups: string[];
  link: string;
  linkLabel: string;
  install: InstallSteps;
}

const TOOLS: ToolSpec[] = [
  {
    id: "backups",
    group: "Disaster recovery",
    title: "Backup tool (Velero)",
    why: "Without backups of cluster objects and volumes, a deleted namespace or a lost cluster is gone for good.",
    groups: ["velero.io"],
    link: "/helm",
    linkLabel: "See it in Helm",
    install: {
      tool: "Velero",
      commands: [
        "helm repo add vmware-tanzu https://vmware-tanzu.github.io/helm-charts",
        "helm install velero vmware-tanzu/velero --namespace velero --create-namespace -f values.yaml",
      ],
      docsUrl: "https://velero.io/docs/main/basic-install/",
    },
  },
  {
    id: "metrics-server",
    group: "Platform",
    title: "metrics-server",
    why: "Horizontal autoscaling, kubectl top and Kubebay's live usage columns all read from it.",
    groups: ["metrics.k8s.io"],
    link: "/helm",
    linkLabel: "See it in Helm",
    install: {
      tool: "metrics-server",
      commands: ["kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml"],
      docsUrl: "https://github.com/kubernetes-sigs/metrics-server#installation",
    },
  },
  {
    id: "cert-manager",
    group: "Platform",
    title: "cert-manager",
    why: "It issues and renews TLS certificates, so none expires unnoticed.",
    groups: ["cert-manager.io"],
    link: "/helm",
    linkLabel: "See it in Helm",
    install: {
      tool: "cert-manager",
      commands: [
        "helm repo add jetstack https://charts.jetstack.io",
        "helm install cert-manager jetstack/cert-manager --namespace cert-manager --create-namespace --set crds.enabled=true",
      ],
      docsUrl: "https://cert-manager.io/docs/installation/",
    },
  },
  {
    id: "policy-engine",
    group: "Security",
    title: "Policy engine (Kyverno or Gatekeeper)",
    why: "It rejects risky manifests, such as privileged pods or unsigned images, before they run.",
    groups: ["kyverno.io", "templates.gatekeeper.sh", "constraints.gatekeeper.sh"],
    link: "/helm",
    linkLabel: "See it in Helm",
    install: {
      tool: "Kyverno",
      commands: [
        "helm repo add kyverno https://kyverno.github.io/kyverno/",
        "helm install kyverno kyverno/kyverno --namespace kyverno --create-namespace",
      ],
      docsUrl: "https://kyverno.io/docs/installation/",
    },
  },
  {
    id: "image-scanner",
    group: "Security",
    title: "Image scanner (Trivy-Operator)",
    why: "It scans running images for known CVEs, which Kubebay then lists on the Vulnerabilities page.",
    groups: ["aquasecurity.github.io"],
    link: "/vulnerabilities",
    linkLabel: "Open Vulnerabilities",
    install: {
      tool: "Trivy-Operator",
      commands: [
        "helm repo add aqua https://aquasecurity.github.io/helm-charts/",
        "helm install trivy-operator aqua/trivy-operator --namespace trivy-system --create-namespace",
      ],
      docsUrl: "https://aquasecurity.github.io/trivy-operator/latest/getting-started/installation/helm/",
    },
  },
];

function toolCheck(spec: ToolSpec, apiGroups: string[] | undefined): Raw {
  const base = { id: spec.id, group: spec.group, title: spec.title, why: spec.why };
  if (!apiGroups) return UNKNOWN(base, "the cluster's API list");
  if (spec.groups.some((g) => apiGroups.includes(g))) {
    return { ...base, status: "pass", detail: "Detected.", link: spec.link, linkLabel: spec.linkLabel };
  }
  return {
    ...base,
    status: "fail",
    detail: `${spec.install.tool} not detected. A managed add-on or another tool may cover this; Kubebay can't see those.`,
    install: spec.install,
  };
}

/**
 * Backlog #36: the best-practices checklist, derived only from what the app
 * already reads (workload specs, PDBs, NetworkPolicies, namespaces, IngressClasses
 * and the API groups discovery lists). Pure and read-only: a resource the app
 * couldn't read (undefined) gives "unknown", never a pass.
 */
export function computeBestPractices(input: BestPracticesInput): BestPracticeCheck[] {
  return computeRaw(input).map((r) => {
    const { severity, learn, cis } = META[r.id]!;
    const out: BestPracticeCheck = { ...r, severity, learn };
    if (cis) out.reference = `CIS ${cis}`;
    if (r.status === "fail" && r.allOffenders && !CLUSTER_WIDE.has(r.id)) {
      out.namespaces = namespacesOf(r.id, r.allOffenders);
    }
    return out;
  });
}

/** Checks whose offenders are cluster-wide objects, so no namespace applies. */
const CLUSTER_WIDE = new Set(["nodes-ready", "node-version-skew"]);
/** Checks whose offenders are bare namespace names rather than "ns/name". */
const NAMESPACE_NAMED = new Set(["network-policies", "pod-security"]);

export function offenderNamespace(id: string, offender: string): string {
  return NAMESPACE_NAMED.has(id) ? offender : (offender.split("/")[0] ?? "");
}
export function namespacesOf(id: string, offenders: string[]): string[] {
  return [...new Set(offenders.map((o) => offenderNamespace(id, o)).filter(Boolean))];
}

function computeRaw(input: BestPracticesInput): Raw[] {
  const { deployments, statefulsets, pdbs, networkPolicies, namespaces, ingressClasses, apiGroups } = input;
  const workloads =
    deployments && statefulsets
      ? [
          ...toWorkloads(deployments),
          ...toWorkloads(statefulsets, "statefulset"),
          ...toWorkloads(input.daemonsets ?? [], "daemonset"),
          ...toWorkloads(input.cronjobs ?? [], "cronjob"),
          ...toWorkloads(input.pods ?? [], "pod"),
        ]
      : undefined;
  const userNamespaces = namespaces?.map((n) => str(rec(n.metadata).name)).filter((n) => n && !SYSTEM_NAMESPACES.has(n));

  const pdbBase = {
    id: "pdb",
    group: "Reliability" as const,
    title: "PodDisruptionBudgets on multi-replica workloads",
    why: "A node drain or upgrade can otherwise evict every replica at once and take the service down.",
  };
  const pdbCheck =
    !workloads || !pdbs
      ? UNKNOWN(pdbBase, "deployments, statefulsets or PodDisruptionBudgets")
      : listResult(
          pdbBase,
          workloads
            .filter((w) => w.replicas > 1)
            .filter(
              (w) =>
                !pdbs.some(
                  (p) => str(rec(p.metadata).namespace) === w.ns && matchesSelector(w.labels, rec(rec(p.spec).selector) as LabelSelector),
                ),
            )
            .map(name),
          "multi-replica workloads without a PodDisruptionBudget",
          "Every multi-replica workload has a PodDisruptionBudget.",
        );

  const reqBase = {
    id: "requests-limits",
    group: "Reliability" as const,
    title: "Resource requests and memory limits",
    why: "Without requests the scheduler guesses and nodes overcommit; without a memory limit one leak can starve its neighbours.",
  };
  const reqCheck = !workloads
    ? UNKNOWN(reqBase, "deployments or statefulsets")
    : listResult(
        reqBase,
        workloads
          .filter((w) =>
            w.containers.some((c) => {
              const r = rec(c.resources);
              const req = rec(r.requests);
              return !req.cpu || !req.memory || !rec(r.limits).memory;
            }),
          )
          .map(name),
        "workloads with a container missing requests or a memory limit",
        "Every container sets CPU and memory requests and a memory limit.",
        { link: "/right-sizing", linkLabel: "Open Right-sizing" },
      );

  const probeBase = {
    id: "probes",
    group: "Reliability" as const,
    title: "Readiness probes",
    why: "Without one, traffic and rollouts treat a container as ready the moment it starts.",
  };
  const probeCheck = !workloads
    ? UNKNOWN(probeBase, "deployments or statefulsets")
    : listResult(
        probeBase,
        workloads.filter((w) => w.containers.some((c) => !c.readinessProbe)).map(name),
        "workloads with a container that has no readiness probe",
        "Every container has a readiness probe.",
      );

  const netBase = {
    id: "network-policies",
    group: "Security" as const,
    title: "NetworkPolicies in each namespace with workloads",
    why: "With no policy, every pod can talk to every other pod; one compromised pod can reach them all.",
  };
  let netCheck: Raw;
  if (!workloads || !networkPolicies || !userNamespaces) {
    netCheck = UNKNOWN(netBase, "workloads, namespaces or NetworkPolicies");
  } else {
    const withWorkloads = new Set(workloads.map((w) => w.ns));
    const withPolicy = new Set(networkPolicies.map((p) => str(rec(p.metadata).namespace)));
    netCheck = listResult(
      netBase,
      [...withWorkloads].filter((n) => userNamespaces.includes(n) && !withPolicy.has(n)).sort(),
      "namespaces with workloads and no NetworkPolicy",
      "Every namespace with workloads has a NetworkPolicy.",
      { link: "/network-policy", linkLabel: "Open Network policy" },
    );
    if (netCheck.status === "pass") Object.assign(netCheck, { link: "/network-policy", linkLabel: "Open Network policy" });
  }

  const psaBase = {
    id: "pod-security",
    group: "Security" as const,
    title: "Pod Security Admission labels",
    why: "The enforce label makes the cluster refuse privileged or host-access pods in that namespace.",
  };
  const psaCheck = !userNamespaces
    ? UNKNOWN(psaBase, "namespaces")
    : listResult(
        psaBase,
        userNamespaces
          .filter((n) => {
            const ns = namespaces!.find((o) => str(rec(o.metadata).name) === n);
            return !str(rec(rec(ns?.metadata).labels)["pod-security.kubernetes.io/enforce"]);
          })
          .sort(),
        "namespaces without a pod-security.kubernetes.io/enforce label",
        "Every namespace sets a Pod Security enforce level.",
      );

  const ingressBase = {
    id: "ingress",
    group: "Platform" as const,
    title: "Ingress controller",
    why: "Ingress objects do nothing until a controller serves them.",
  };
  let ingressCheck: Raw;
  if (!ingressClasses) ingressCheck = UNKNOWN(ingressBase, "IngressClasses");
  else if (ingressClasses.length > 0) {
    ingressCheck = { ...ingressBase, status: "pass", detail: `${ingressClasses.length} IngressClass${ingressClasses.length === 1 ? "" : "es"} found.`, link: "/helm", linkLabel: "See it in Helm" };
  } else {
    ingressCheck = {
      ...ingressBase,
      status: "fail",
      detail: "No IngressClass found. A Gateway API controller or a cloud load balancer may cover this.",
      install: {
        tool: "ingress-nginx",
        commands: [
          "helm upgrade --install ingress-nginx ingress-nginx --repo https://kubernetes.github.io/ingress-nginx --namespace ingress-nginx --create-namespace",
        ],
        docsUrl: "https://kubernetes.github.io/ingress-nginx/deploy/",
      },
    };
  }

  const tool = (id: string) => toolCheck(TOOLS.find((t) => t.id === id)!, apiGroups);

  return [
    pdbCheck,
    reqCheck,
    probeCheck,
    netCheck,
    psaCheck,
    tool("policy-engine"),
    tool("image-scanner"),
    tool("backups"),
    tool("metrics-server"),
    ingressCheck,
    tool("cert-manager"),
    ...extraChecks(input, workloads),
  ];
}

const WORKLOAD_LINK = { link: "/r/deployments", linkLabel: "Open Deployments" };

function workloadCheck(
  workloads: Workload[] | undefined,
  base: Omit<Raw, "status" | "detail" | "offenders">,
  bad: (w: Workload) => boolean,
  noun: string,
  passDetail: string,
): Raw {
  if (!workloads) return UNKNOWN(base, "deployments or statefulsets");
  return listResult(base, workloads.filter(bad).map(name), noun, passDetail, WORKLOAD_LINK);
}

const anyContainer = (w: Workload, f: (c: Obj) => boolean) => w.containers.some(f);
const sc = (c: Obj) => rec(c.securityContext);

function untagged(image: string): boolean {
  if (!image || image.includes("@")) return false;
  const last = image.split("/").pop() ?? image;
  const i = last.indexOf(":");
  return i < 0 || last.slice(i + 1) === "latest";
}

const SENSITIVE_NAME = /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|credential)/i;

function isReady(node: Obj): boolean {
  return arr(rec(node.status).conditions).some((c) => str(rec(c).type) === "Ready" && str(rec(c).status) === "True");
}
function minor(version: string): string {
  const m = /^v?(\d+)\.(\d+)/.exec(version);
  return m ? `${m[1]}.${m[2]}` : "";
}
const objName = (o: Obj): string => {
  const m = rec(o.metadata);
  return str(m.namespace) ? `${str(m.namespace)}/${str(m.name)}` : str(m.name);
};
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function extraChecks(input: BestPracticesInput, workloads: Workload[] | undefined): Raw[] {
  const mk = (id: string, group: CheckGroup, title: string, why: string): Omit<Raw, "status" | "detail" | "offenders"> => ({
    id,
    group,
    title,
    why,
  });

  const privileged = workloadCheck(
    workloads,
    mk("privileged", "Security", "No privileged containers", "A privileged container has nearly the host's full power; escaping it means owning the node."),
    (w) => anyContainer(w, (c) => sc(c).privileged === true),
    "workloads with a privileged container",
    "No container is privileged.",
  );
  const hostAccess = workloadCheck(
    workloads,
    mk("host-access", "Security", "No hostNetwork, hostPID or hostPath", "Sharing the node's network, processes or filesystem lets a compromised pod see or alter the node."),
    (w) => w.pod.hostNetwork === true || w.pod.hostPID === true || arr(w.pod.volumes).some((v) => !!rec(v).hostPath),
    "workloads using hostNetwork, hostPID or a hostPath volume",
    "No workload shares the node's network, processes or filesystem.",
  );
  const root = workloadCheck(
    workloads,
    mk("runs-as-root", "Security", "Containers don't run as root", "A process running as root inside a container does more damage if it is compromised."),
    (w) => {
      const podSc = rec(w.pod.securityContext);
      return anyContainer(w, (c) => sc(c).runAsUser === 0 || sc(c).runAsNonRoot === false) || podSc.runAsUser === 0 || podSc.runAsNonRoot === false;
    },
    "workloads explicitly running as root",
    "No workload sets runAsUser 0 or runAsNonRoot false.",
  );
  const latest = workloadCheck(
    workloads,
    mk("latest-tag", "Reliability", "Images use a pinned tag", "A latest or missing tag means a restart can pull different code than the one you tested, and rollbacks are guesswork."),
    (w) => anyContainer(w, (c) => untagged(str(c.image))),
    "workloads with a container image on :latest or with no tag",
    "Every image has a tag or digest.",
  );
  const liveness = workloadCheck(
    workloads,
    mk("liveness", "Reliability", "Liveness probes", "Without one, Kubernetes can't restart a container that is running but stuck."),
    (w) => anyContainer(w, (c) => !c.livenessProbe),
    "workloads with a container that has no liveness probe",
    "Every container has a liveness probe.",
  );
  const automount = workloadCheck(
    workloads,
    mk("sa-automount", "Security", "Default ServiceAccount token not mounted", "A pod on the default ServiceAccount that mounts its token hands any attacker inside it an API credential."),
    (w) => {
      const sa = str(w.pod.serviceAccountName) || str(w.pod.serviceAccount);
      return (!sa || sa === "default") && w.pod.automountServiceAccountToken !== false;
    },
    "workloads on the default ServiceAccount with its token mounted",
    "No workload mounts the default ServiceAccount's token.",
  );
  const secretsEnv = workloadCheck(
    workloads,
    mk("secrets-in-env", "Security", "No plain-text secrets in env vars", "A password written into a manifest is readable by anyone who can read the workload, and tends to end up in source control."),
    (w) => anyContainer(w, (c) => arr(c.env).some((e) => SENSITIVE_NAME.test(str(rec(e).name)) && str(rec(e).value) !== "" && !rec(e).valueFrom)),
    "workloads with a plain-text value on a secret-looking env var",
    "No secret-looking env var holds a plain-text value.",
  );

  const lbBase = mk("lb-source-ranges", "Security", "LoadBalancer Services limit source ranges", "A LoadBalancer with no source ranges is open to the whole internet on its ports.");
  const lb = !input.services
    ? UNKNOWN(lbBase, "Services")
    : listResult(
        lbBase,
        input.services
          .filter((s) => str(rec(s.spec).type) === "LoadBalancer" && arr(rec(s.spec).loadBalancerSourceRanges).length === 0)
          .filter((s) => !SYSTEM_NAMESPACES.has(str(rec(s.metadata).namespace)))
          .map(objName),
        "LoadBalancer Services without loadBalancerSourceRanges",
        "Every LoadBalancer Service limits its source ranges.",
        { link: "/r/services", linkLabel: "Open Services" },
      );

  const pvcBase = mk("pvc-backup", "Disaster recovery", "Volumes have a backup schedule", "A PersistentVolumeClaim holds state; with no backup schedule a deleted volume or lost zone loses it.");
  let pvc: Raw;
  if (!input.pvcs || !input.veleroSchedules) pvc = UNKNOWN(pvcBase, "PersistentVolumeClaims or Velero schedules");
  else if (input.pvcs.length === 0) pvc = { ...pvcBase, status: "pass", detail: "No PersistentVolumeClaims to back up." };
  else if (input.veleroSchedules.length > 0) {
    pvc = { ...pvcBase, status: "pass", detail: `${plural(input.pvcs.length, "PVC")}; ${plural(input.veleroSchedules.length, "Velero schedule")} found.` };
  } else {
    pvc = {
      ...pvcBase,
      status: "fail",
      detail: `${plural(input.pvcs.length, "PVC")} and no Velero schedule detected. A managed snapshot policy may cover this; Kubebay can't see it.`,
      offenders: input.pvcs.slice(0, MAX_OFFENDERS).map(objName),
      link: "/r/persistentvolumeclaims",
      linkLabel: "Open PersistentVolumeClaims",
    };
  }

  const nodeLink = { link: "/r/nodes", linkLabel: "Open Nodes" };
  const nodeBase = mk("nodes-ready", "Reliability", "All nodes Ready", "A NotReady node stops running its pods, and the cluster has less room than you think.");
  const nodes = !input.nodes
    ? UNKNOWN(nodeBase, "Nodes")
    : listResult(nodeBase, input.nodes.filter((n) => !isReady(n)).map(objName), "nodes not Ready", "Every node is Ready.", nodeLink);
  if (nodes.status === "pass") Object.assign(nodes, nodeLink);

  const skewBase = mk("node-version-skew", "Platform", "Nodes run one Kubernetes minor version", "Mixed kubelet versions mean a half-finished upgrade; the supported skew is small and shrinking.");
  let skew: Raw;
  if (!input.nodes) skew = UNKNOWN(skewBase, "Nodes");
  else {
    const versions = new Map<string, string[]>();
    for (const n of input.nodes) {
      const v = minor(str(rec(rec(n.status).nodeInfo).kubeletVersion));
      if (v) versions.set(v, [...(versions.get(v) ?? []), objName(n)]);
    }
    if (versions.size <= 1) {
      skew = {
        ...skewBase,
        status: "pass",
        detail: versions.size === 1 ? `All nodes on ${[...versions.keys()][0]}.` : "No node versions to compare.",
        ...nodeLink,
      };
    } else {
      const sorted = [...versions.keys()].sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]));
      skew = {
        ...skewBase,
        status: "fail",
        detail: `Nodes run ${versions.size} minor versions: ${sorted.join(", ")}.`,
        offenders: (versions.get(sorted[0]!) ?? []).slice(0, MAX_OFFENDERS),
        ...nodeLink,
      };
    }
  }

  const certBase = mk("cert-expiry", "Platform", "Certificates not near expiry", "An expired certificate takes a service offline for every client at once.");
  const soon = (input.now ?? Date.now()) + 14 * 86_400_000;
  const certs: Raw = !input.certificates
    ? UNKNOWN(certBase, "cert-manager Certificates")
    : input.certificates.length === 0
      ? { ...certBase, status: "pass", detail: "No cert-manager Certificates found." }
      : listResult(
          certBase,
          input.certificates
            .filter((c) => {
              const st = rec(c.status);
              const exp = Date.parse(str(st.notAfter));
              const ready = arr(st.conditions).some((x) => str(rec(x).type) === "Ready" && str(rec(x).status) === "True");
              return !ready || (!Number.isNaN(exp) && exp < soon);
            })
            .map(objName),
          "Certificates expiring within 14 days or not Ready",
          "No Certificate expires within 14 days.",
        );

  const hpaBase = mk("hpa-max", "Reliability", "Autoscalers have headroom", "An HPA at its maximum can't add replicas, so more load means slower or failing requests.");
  const hpa = !input.hpas
    ? UNKNOWN(hpaBase, "HorizontalPodAutoscalers")
    : listResult(
        hpaBase,
        input.hpas
          .filter((h) => {
            const max = rec(h.spec).maxReplicas;
            const cur = rec(h.status).currentReplicas;
            return typeof max === "number" && typeof cur === "number" && cur >= max;
          })
          .map(objName),
        "HorizontalPodAutoscalers running at their maximum",
        "No HorizontalPodAutoscaler is at its maximum.",
        { link: "/r/horizontalpodautoscalers", linkLabel: "Open HorizontalPodAutoscalers" },
      );

  return [privileged, hostAccess, root, latest, liveness, automount, secretsEnv, lb, pvc, nodes, skew, certs, hpa];
}

const K = "https://kubernetes.io/docs/";
const PSS = K + "concepts/security/pod-security-standards/";
const PROBES = K + "tasks/configure-pod-container/configure-liveness-readiness-startup-probes/";
/**
 * `cis` is a reference to the CIS Kubernetes Benchmark section (numbering of v1.8),
 * set only where the control plainly matches the check. It is not a compliance claim.
 */
const META: Record<string, { severity: Severity; learn: Lesson; cis?: string }> = {
  pdb: { severity: "Medium", learn: { text: "A PodDisruptionBudget tells Kubernetes how many replicas of an app may be down at once. Drains and upgrades then wait instead of taking them all.", docsUrl: K + "tasks/run-application/configure-pdb/" } },
  "requests-limits": { severity: "Medium", learn: { text: "A request is what the scheduler reserves for a container; a limit is the most it may use. Requests keep nodes honest; a memory limit stops one leak from starving its neighbours.", docsUrl: K + "concepts/configuration/manage-resources-containers/" } },
  probes: { severity: "Medium", learn: { text: "A readiness probe tells Kubernetes when a container can take traffic. Until it passes, the Service skips the pod and a rollout waits.", docsUrl: PROBES } },
  "network-policies": { severity: "High", learn: { text: "By default every pod can reach every other pod. A NetworkPolicy narrows that to the paths you intend, so a compromised pod can't roam.", docsUrl: K + "concepts/services-networking/network-policies/" }, cis: "5.3.2" },
  "pod-security": { severity: "High", learn: { text: "Pod Security Admission checks pods against the Privileged, Baseline or Restricted standard when they are created. The enforce label makes it refuse the ones that fail.", docsUrl: K + "concepts/security/pod-security-admission/" } },
  "policy-engine": { severity: "Medium", learn: { text: "An admission policy engine rules on every manifest before it runs, so rules such as no latest tags or no privileged pods hold for everyone.", docsUrl: K + "reference/access-authn-authz/validating-admission-policy/" } },
  "image-scanner": { severity: "Medium", learn: { text: "An image scanner compares the packages in your images to lists of known vulnerabilities and reports the ones you run.", docsUrl: "https://aquasecurity.github.io/trivy-operator/latest/" } },
  backups: { severity: "Critical", learn: { text: "Backups copy cluster objects and volume data somewhere else, so you can rebuild after a deleted namespace, a bad deploy or a lost cluster.", docsUrl: "https://velero.io/docs/main/" } },
  "metrics-server": { severity: "Low", learn: { text: "metrics-server collects CPU and memory use from each node. Autoscalers and kubectl top read it.", docsUrl: K + "tasks/debug/debug-cluster/resource-metrics-pipeline/" } },
  ingress: { severity: "Low", learn: { text: "An Ingress describes how outside traffic reaches Services, but a controller must run to act on it. The IngressClass names that controller.", docsUrl: K + "concepts/services-networking/ingress-controllers/" } },
  "cert-manager": { severity: "Medium", learn: { text: "cert-manager requests TLS certificates, stores them as Secrets and renews them before they expire.", docsUrl: "https://cert-manager.io/docs/" } },
  privileged: { severity: "Critical", learn: { text: "A privileged container skips most of the isolation containers give. Few workloads need it; a node agent might, an ordinary web app doesn't.", docsUrl: PSS }, cis: "5.2.2" },
  "host-access": { severity: "High", learn: { text: "hostNetwork, hostPID and hostPath put a pod in the node's own network, process list or files. Prefer Services and volumes the cluster manages.", docsUrl: PSS } },
  "runs-as-root": { severity: "High", learn: { text: "Set runAsNonRoot: true (or a numeric runAsUser) in the securityContext so the container's process isn't root, even inside the container.", docsUrl: K + "tasks/configure-pod-container/security-context/" }, cis: "5.2.7" },
  "latest-tag": { severity: "Medium", learn: { text: "Tags like latest move. Pin a version tag, or a digest, so the same manifest always runs the same image and a rollback restores the old one.", docsUrl: K + "concepts/containers/images/#image-names" } },
  liveness: { severity: "Low", learn: { text: "A liveness probe lets the kubelet restart a container that has hung. Keep it cheap and independent of other services so a slow dependency doesn't cause restarts.", docsUrl: PROBES } },
  "sa-automount": { severity: "Medium", learn: { text: "Pods mount a ServiceAccount token by default. Give each app its own ServiceAccount, and set automountServiceAccountToken: false where the app never calls the API.", docsUrl: K + "tasks/configure-pod-container/configure-service-account/" }, cis: "5.1.6" },
  "secrets-in-env": { severity: "High", learn: { text: "Keep credentials in a Secret and reference them with valueFrom.secretKeyRef, or mount them as files. Better still, pull them from an external secrets manager.", docsUrl: K + "concepts/configuration/secret/" } },
  "lb-source-ranges": { severity: "Medium", learn: { text: "Set spec.loadBalancerSourceRanges on a LoadBalancer Service to the CIDRs that should reach it. Your cloud's load balancer then drops everyone else.", docsUrl: K + "concepts/services-networking/service/#loadbalancer" } },
  "pvc-backup": { severity: "High", learn: { text: "Volume data isn't in your manifests. A scheduled backup (Velero with volume snapshots or file-system backup) is what brings it back.", docsUrl: "https://velero.io/docs/main/backup-reference/" } },
  "nodes-ready": { severity: "High", learn: { text: "A node reports Ready when its kubelet is healthy and can run pods. NotReady nodes lose their pods after a few minutes; check the node's conditions and kubelet logs.", docsUrl: K + "tasks/debug/debug-cluster/" } },
  "node-version-skew": { severity: "Medium", learn: { text: "Upgrade the control plane first, then nodes. A kubelet may be older than the API server by a few minor versions, never newer.", docsUrl: K + "setup/release/version-skew-policy/" } },
  "cert-expiry": { severity: "High", learn: { text: "cert-manager renews a Certificate before it expires. One that is not Ready or close to expiry usually means the issuer or a challenge is failing; describe the Certificate to see why.", docsUrl: "https://cert-manager.io/docs/troubleshooting/" } },
  "hpa-max": { severity: "Medium", learn: { text: "A HorizontalPodAutoscaler adds replicas up to maxReplicas. At the maximum it can't help, so raise the max (if nodes allow) or find out why load is so high.", docsUrl: K + "tasks/run-application/horizontal-pod-autoscale/" } },
};

// Summary, sort and filter

export interface Summary {
  total: number;
  pass: number;
  fail: number;
  unknown: number;
  /** Checks the user chose to ignore; left out of the score. */
  ignored: number;
  /** Share of all checks that pass; unknown counts against it, never for it. */
  score: number;
  failedBySeverity: Record<Severity, number>;
}

export function summarize(checks: BestPracticeCheck[]): Summary {
  const failedBySeverity: Record<Severity, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  let pass = 0;
  let fail = 0;
  let unknown = 0;
  let ignored = 0;
  for (const c of checks) {
    if (c.status === "pass") pass++;
    else if (c.status === "fail") {
      fail++;
      failedBySeverity[c.severity]++;
    } else if (c.status === "ignored") ignored++;
    else unknown++;
  }
  const total = checks.length;
  const scored = total - ignored;
  return { total, pass, fail, unknown, ignored, score: scored ? Math.round((pass / scored) * 100) : 0, failedBySeverity };
}

export type SortKey = "group" | "severity" | "status";
const SEV_RANK: Record<Severity, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const STATUS_RANK: Record<CheckStatus, number> = { fail: 0, unknown: 1, ignored: 2, pass: 3 };

/** A stable sort: ties keep the checklist's own order. "group" keeps it as is. */
export function sortChecks(checks: BestPracticeCheck[], key: SortKey): BestPracticeCheck[] {
  if (key === "group") return checks;
  const rank = (c: BestPracticeCheck) => (key === "severity" ? SEV_RANK[c.severity] : STATUS_RANK[c.status]);
  return checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || (key === "status" ? SEV_RANK[a.c.severity] - SEV_RANK[b.c.severity] : 0) || a.i - b.i)
    .map((x) => x.c);
}

export function filterChecks(
  checks: BestPracticeCheck[],
  f: { severity: Severity | "all"; status: CheckStatus | "all" },
): BestPracticeCheck[] {
  return checks.filter((c) => (f.severity === "all" || c.severity === f.severity) && (f.status === "all" || c.status === f.status));
}
