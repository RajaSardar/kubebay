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

export type CheckStatus = "pass" | "fail" | "unknown";
export type CheckGroup = "Reliability" | "Security" | "Disaster recovery" | "Platform";

export interface InstallSteps {
  /** The tool's name, for the disclosure heading. */
  tool: string;
  /** Shown as text only. Kubebay never runs these. */
  commands: string[];
  /** The official instructions. */
  docsUrl: string;
}

export interface BestPracticeCheck {
  id: string;
  group: CheckGroup;
  title: string;
  status: CheckStatus;
  /** What was found, in one line. */
  detail: string;
  /** Why the check matters, in one line. */
  why: string;
  /** Up to three things that failed, "ns/name". */
  offenders?: string[];
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
}

const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease"]);
const MAX_OFFENDERS = 3;

interface Workload {
  ns: string;
  name: string;
  replicas: number;
  labels: Record<string, string>;
  containers: Obj[];
}

function toWorkloads(items: Obj[]): Workload[] {
  const out: Workload[] = [];
  for (const o of items) {
    const meta = rec(o.metadata);
    const ns = str(meta.namespace);
    if (SYSTEM_NAMESPACES.has(ns)) continue;
    const spec = rec(o.spec);
    const tpl = rec(spec.template);
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec(rec(tpl.metadata).labels))) if (typeof v === "string") labels[k] = v;
    out.push({
      ns,
      name: str(meta.name),
      replicas: typeof spec.replicas === "number" ? spec.replicas : 1,
      labels,
      containers: arr(rec(tpl.spec).containers).map(rec),
    });
  }
  return out;
}

function name(w: Workload): string {
  return `${w.ns}/${w.name}`;
}

function listResult(
  base: Omit<BestPracticeCheck, "status" | "detail" | "offenders">,
  offenders: string[],
  noun: string,
  passDetail: string,
  link?: Pick<BestPracticeCheck, "link" | "linkLabel">,
): BestPracticeCheck {
  if (offenders.length === 0) return { ...base, status: "pass", detail: passDetail };
  return {
    ...base,
    ...link,
    status: "fail",
    detail: `${offenders.length} ${noun}`,
    offenders: offenders.slice(0, MAX_OFFENDERS),
  };
}

const UNKNOWN = (base: Omit<BestPracticeCheck, "status" | "detail">, what: string): BestPracticeCheck => ({
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

function toolCheck(spec: ToolSpec, apiGroups: string[] | undefined): BestPracticeCheck {
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
  const { deployments, statefulsets, pdbs, networkPolicies, namespaces, ingressClasses, apiGroups } = input;
  const workloads = deployments && statefulsets ? [...toWorkloads(deployments), ...toWorkloads(statefulsets)] : undefined;
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
  let netCheck: BestPracticeCheck;
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
  let ingressCheck: BestPracticeCheck;
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
  ];
}
