// What each page of the app is and how it works, for the ⓘ beside its title
// (root backlog #18, docs/HELP_TIPS_RESEARCH.md). One place for the copy, so
// it reads as one voice; lib/__tests__/help.test.ts checks every page has an
// entry and that each links to a page of the user manual that exists.

export interface PageHelpEntry {
  /** The page's name in "About …", the button's accessible name. */
  name: string;
  /** What the page is: one sentence. */
  what: string;
  /** How it works: where its data comes from and what it needs. One sentence. */
  how: string;
  /** Its page in the manual (website/src/content/docs), with an optional #heading. */
  docs: string;
}

const DOCS_BASE = "https://kubebay.sardar.dev/docs/";

/** The manual's URL for "slug" or "slug#heading". */
export function docsUrl(docs: string): string {
  const [slug, anchor] = docs.split("#");
  return `${DOCS_BASE}${slug}/${anchor ? `#${anchor}` : ""}`;
}

/** Keyed by the page's route, as App.tsx declares it. */
export const PAGE_HELP: Record<string, PageHelpEntry> = {
  "/clusters": {
    name: "Clusters",
    what: "Every context in your kubeconfig, with whether its API server is reachable, its version and its load.",
    how: "Kubebay reads KUBECONFIG or ~/.kube/config and follows changes to it; click a cluster to connect.",
    docs: "connect-clusters",
  },
  "/workloads-overview": {
    name: "Overview",
    what: "The cluster at a glance: what's broken and why, rollouts, capacity, single points of failure and Service health.",
    how: "Worked out live from the pods, workloads, nodes, events and Services Kubebay streams; nothing is installed in the cluster.",
    docs: "workloads-overview",
  },
  "/workloads": {
    name: "Pods",
    what: "Every pod in the namespaces you picked, as it changes; click one for its logs, terminal, graphs and YAML.",
    how: "A live watch of the cluster's pods; filter with words or key:value, such as status:crash or node:worker-2.",
    docs: "pods",
  },
  "/r/:kind": {
    name: "this table",
    what: "A live table of one kind of Kubernetes resource, with row actions, bulk delete and a create button.",
    how: "Kubebay watches the kind through the API server, so rows change as the cluster does; filter with words or key:value.",
    docs: "resources",
  },
  "/network-policy": {
    name: "Network policies",
    what: "Who can talk to whom: a connectivity matrix, coverage gaps, a reachability check and a policy builder.",
    how: "Kubebay evaluates your NetworkPolicies against the pods' labels; the builder dry-runs a policy before it creates it.",
    docs: "network-policy",
  },
  "/crds": {
    name: "CRDs",
    what: "Every CustomResourceDefinition on the cluster, grouped by API group; click a kind for its table.",
    how: "Read from the API server's discovery data, so a CRD installed a minute ago is already here.",
    docs: "crds",
  },
  "/create-resource": {
    name: "Create Resource",
    what: "Create any resource from a template or your own YAML.",
    how: "Dry run has the API server validate it, admission webhooks included, without saving; Apply creates it.",
    docs: "create-resource",
  },
  "/terminal": {
    name: "Terminal",
    what: "A shell on your own machine, with kubectl and your other tools, bound to one cluster's context.",
    how: "The shell gets a kubeconfig that only sets the context, so your credentials stay where they are.",
    docs: "terminal",
  },
  "/ports": {
    name: "Port forwards",
    what: "Forward a pod's port to your machine without keeping a terminal open.",
    how: "Tunnels bind to 127.0.0.1 only and stop when the engine stops.",
    docs: "port-forwarding",
  },
  "/helm": {
    name: "Helm",
    what: "Every Helm release with its history, values and manifest, and a store of the charts in your repos.",
    how: "Kubebay reads the release records the helm CLI does, and your local Helm repo config.",
    docs: "helm",
  },
  "/argocd": {
    name: "Argo CD",
    what: "Your Argo CD Applications' sync status, health and drift, resource by resource.",
    how: "Read from the Application objects through the Kubernetes API, so it needs no Argo CD login.",
    docs: "argocd",
  },
  "/flux": {
    name: "Flux",
    what: "Flux Kustomizations and HelmReleases: whether each is Ready, what it manages, and drift Flux corrected.",
    how: "Read from Flux's own objects and events; Flux fixes drift as it reconciles, so there's no diff view.",
    docs: "flux",
  },
  "/rbac": {
    name: "RBAC and security",
    what: "Who can do what, risky permissions, attack paths, exposed secrets and image signatures.",
    how: "Each check reads Roles, bindings and workloads with your own credentials; nothing is installed in the cluster.",
    docs: "rbac",
  },
  "/vulnerabilities": {
    name: "Vulnerabilities",
    what: "Every CVE Trivy-Operator found on the cluster, one row per workload, worst first.",
    how: "Read from Trivy-Operator's VulnerabilityReports; a ReplicaSet's reports count under its Deployment.",
    docs: "vulnerabilities",
  },
  "/right-sizing": {
    name: "Right-sizing",
    what: "CPU and memory requests far from what workloads use, ranked by waste, with a dry-run preview and apply.",
    how: "From VPA recommendations, or Kubebay's own p95 of Prometheus (7 days) or metrics-server (3 hours) samples.",
    docs: "right-sizing",
  },
  "/cost-waste": {
    name: "Cost / Waste",
    what: "Where the cluster's capacity goes: requested, used and idle, with consolidation and spot risk.",
    how: "Capacity accounting in CPU and memory from requests and allocatable, plus usage when metrics are available.",
    docs: "cost-waste",
  },
  "/karpenter": {
    name: "Karpenter",
    what: "Your Karpenter NodePools: what runs on each, spot against on-demand, and pods that can't be placed.",
    how: "Read from NodePools, nodes and scheduler events; an edit that would evict pods asks you to type the name.",
    docs: "karpenter",
  },
  "/keda": {
    name: "KEDA",
    what: "Every KEDA ScaledObject in plain words, HPAs that fight them, and scale-to-zero workloads.",
    how: "Read from KEDA's ScaledObjects and TriggerAuthentications and the cluster's HPAs.",
    docs: "keda",
  },
  "/upgrade-readiness": {
    name: "Upgrade Readiness",
    what: "API versions your cluster still serves that the next Kubernetes releases remove.",
    how: "Read from the API server's discovery data, against Kubernetes' deprecation guide.",
    docs: "upgrade-readiness",
  },
  "/audit": {
    name: "Audit Log",
    what: "Every change you made through Kubebay, and every call an AI assistant made.",
    how: "A file on your machine that Kubebay appends to; it's never sent anywhere.",
    docs: "audit-log",
  },
  "/timeline": {
    name: "Timeline",
    what: "The cluster's events as they happen, with a warnings-only view and an hour of warning activity.",
    how: "A live watch of the cluster's events; the API server keeps them for about an hour by default.",
    docs: "timeline",
  },
  "/topology": {
    name: "Topology",
    what: "One namespace drawn as a graph of its workloads, ReplicaSets, pods and Services.",
    how: "Built live from the namespace's objects: owner references link workloads to pods, selectors link Services.",
    docs: "topology",
  },
  "/settings": {
    name: "Settings",
    what: "Themes and display, Prometheus, the node shell image, usage history, AI features, extensions and updates.",
    how: "Kept on this machine, by the app and its engine; nothing here is stored in a cluster.",
    docs: "settings",
  },
};
