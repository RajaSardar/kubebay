// KB-02: the comparison table's data. Every cell names its source and the
// day it was checked; comparison.test.ts fails the build on a cell without
// one. Performance figures (RAM, start-up time, installer size) stay out
// until Kubebay's harness measures every tool the same way.

export interface Source {
  url: string;
  /** The day someone read the source and confirmed the cell (YYYY-MM-DD). */
  checked: string;
  /** What in the source supports the cell, when it isn't obvious. */
  note?: string;
}

export type CellKind = "yes" | "no" | "partial" | "text";

export interface Cell {
  kind: CellKind;
  label?: string;
  source: Source;
}

export const COLUMNS = ["kubebay", "lens", "freelens", "k9s", "headlamp"] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_NAMES: Record<Column, string> = {
  kubebay: "Kubebay",
  lens: "Lens",
  freelens: "Freelens",
  k9s: "k9s",
  headlamp: "Headlamp",
};

export type Row = { feature: string } & Record<Column, Cell>;

const CHECKED = "2026-10-13";

const kubebay = {
  license: { url: "https://github.com/RajaSardar/kubebay/blob/main/LICENSE", checked: CHECKED },
  prd: {
    url: "https://github.com/RajaSardar/kubebay/blob/main/docs/PRODUCT_REQUIREMENTS.md",
    checked: CHECKED,
    note: "No feature paywalls. Donations/sponsorships only.",
  },
  readme: { url: "https://github.com/RajaSardar/kubebay#readme", checked: CHECKED, note: "Local-first. No accounts." },
  release: {
    url: "https://github.com/RajaSardar/kubebay/releases/tag/v0.6.0",
    checked: CHECKED,
    note: "macOS .dmg, Windows .exe, Linux .deb and .AppImage",
  },
};

const lens = {
  pricing: {
    url: "https://lenshq.io/pricing/",
    checked: CHECKED,
    note: "Personal is free for individuals and companies under $10M in revenue or funding; Plus, Pro and Enterprise are paid.",
  },
  licensing: {
    url: "https://docs.k8slens.dev/faq/subscription-and-licensing/",
    checked: CHECKED,
    note: "Lens Desktop is used under a subscription licence and signs in with a Lens ID on every plan, the free one included.",
  },
  product: { url: "https://lenshq.io/products/lens-k8s-ide/", checked: CHECKED },
};

const freelens = {
  license: { url: "https://github.com/freelensapp/freelens/blob/main/LICENSE", checked: CHECKED },
  readme: {
    url: "https://github.com/freelensapp/freelens#readme",
    checked: CHECKED,
    note: "A free and open-source, standalone application for macOS, Windows and Linux.",
  },
  noSignIn: {
    url: "https://alexandre-vazquez.com/freelens-vs-openlens-vs-lens-kubernetes-ide/",
    checked: CHECKED,
    note: "Freelens is Lens without the Lens ID sign-in.",
  },
};

const k9s = {
  license: { url: "https://github.com/derailed/k9s/blob/master/LICENSE", checked: CHECKED },
  readme: {
    url: "https://github.com/derailed/k9s#readme",
    checked: CHECKED,
    note: "A terminal UI, installed as a binary that reads your kubeconfig. \"K9s will always remain OSS and therefore free!\"",
  },
};

const headlamp = {
  license: { url: "https://github.com/kubernetes-sigs/headlamp/blob/main/LICENSE", checked: CHECKED },
  readme: {
    url: "https://github.com/kubernetes-sigs/headlamp#readme",
    checked: CHECKED,
    note: "Works in-cluster, or locally as a desktop app for Linux, Mac or Windows.",
  },
};

export const rows: Row[] = [
  {
    feature: "License",
    kubebay: { kind: "text", label: "MIT", source: kubebay.license },
    lens: { kind: "text", label: "Proprietary", source: lens.licensing },
    freelens: { kind: "text", label: "MIT", source: freelens.license },
    k9s: { kind: "text", label: "Apache 2.0", source: k9s.license },
    headlamp: { kind: "text", label: "Apache 2.0", source: headlamp.license },
  },
  {
    feature: "Price",
    kubebay: { kind: "yes", label: "Free, no paid tier", source: kubebay.prd },
    lens: { kind: "partial", label: "Free under $10M revenue or funding; paid tiers above", source: lens.pricing },
    freelens: { kind: "yes", label: "Free", source: freelens.readme },
    k9s: { kind: "yes", label: "Free", source: k9s.readme },
    headlamp: { kind: "yes", label: "Free", source: headlamp.license },
  },
  {
    feature: "Account to sign in",
    kubebay: { kind: "yes", label: "None", source: kubebay.readme },
    lens: { kind: "no", label: "Lens ID, free plan included", source: lens.licensing },
    freelens: { kind: "yes", label: "None", source: freelens.noSignIn },
    k9s: { kind: "yes", label: "None", source: k9s.readme },
    headlamp: { kind: "yes", label: "None", source: headlamp.readme },
  },
  {
    feature: "Desktop app",
    kubebay: { kind: "yes", label: "macOS / Windows / Linux", source: kubebay.release },
    lens: { kind: "yes", label: "macOS / Windows / Linux", source: lens.product },
    freelens: { kind: "yes", label: "macOS / Windows / Linux", source: freelens.readme },
    k9s: { kind: "partial", label: "Terminal UI", source: k9s.readme },
    headlamp: { kind: "yes", label: "macOS / Windows / Linux", source: headlamp.readme },
  },
];

// ---------------------------------------------------------------------------
// Where Kubebay goes further. Two groups, each cell read from the tool's own
// pages on the day below and cross-checked by a second reviewer
// (docs/research/2026-11-12-lens-freelens/verdict.md):
//   paid-in-lens   Lens has it on a paid plan; Kubebay's is free.
//   undocumented   Neither Lens's documentation nor Freelens's README,
//                  releases, official extensions or marketplace describe it
//                  (or they describe less). "Not documented" says only that,
//                  not that the tool could never do it, and Lens's pages
//                  don't itemise what a details panel shows, so nothing
//                  here is claimed about a Lens panel tab.
// Left out on purpose: topology, Karpenter and Flux (Freelens has official
// extensions), KEDA (a community extension), and running in a cluster as a
// web app (inferred from packaging; waits for a check of the real apps).
// ---------------------------------------------------------------------------

export const STANDOUT_COLUMNS = ["kubebay", "lens", "freelens"] as const;
export type StandoutColumn = (typeof STANDOUT_COLUMNS)[number];
export type StandoutGroup = "paid-in-lens" | "undocumented";

export type StandoutRow = { feature: string; group: StandoutGroup } & Record<StandoutColumn, Cell>;

export const STANDOUT_GROUP_TITLES: Record<StandoutGroup, string> = {
  "paid-in-lens": "Free in Kubebay. A paid feature in Lens.",
  undocumented: "Not described in Lens's or Freelens's documentation, or described as less.",
};

const NOW = "2026-11-12";

const kbDoc = (page: string, note: string): Source => ({
  url: `https://github.com/RajaSardar/kubebay/blob/main/website/src/content/docs/${page}.md`,
  checked: NOW,
  note,
});
const lensDoc = (path: string, note: string): Source => ({ url: `https://docs.lenshq.io/${path}`, checked: NOW, note });
const lensPricing = (note: string): Source => ({ url: "https://lenshq.io/pricing/", checked: NOW, note });
const lensSitemap = (note: string): Source => ({ url: "https://docs.lenshq.io/sitemap.xml", checked: NOW, note });

// What was searched for Freelens, which has no user manual: its README,
// releases, the official extensions (the marketplace list and the
// freelensapp repositories) and issue titles.
const flNote =
  "Searched the README, every release up to v2.0.0 (28 Oct 2026), the official marketplace extensions (AgentBridge, AI, Flux CD, Kamaji, Resource Map) and the freelensapp repositories (including GPU, Karpenter and Sveltos extensions), and issue titles. None describes this.";
const flMarketplace = (note = flNote): Source => ({
  url: "https://raw.githubusercontent.com/freelensapp/freelens-marketplace/main/extensions.json",
  checked: NOW,
  note,
});

const notDocumented = (source: Source): Cell => ({ kind: "no", label: "Not documented", source });

export const standoutRows: StandoutRow[] = [
  // --- Free in Kubebay, paid in Lens ---------------------------------------
  {
    feature: "Argo CD view",
    group: "paid-in-lens",
    kubebay: {
      kind: "yes",
      label: "Free: sync, health and drift per resource",
      source: kbDoc("argocd", "Reads Application objects through the Kubernetes API with your kubeconfig; no Argo CD login."),
    },
    lens: {
      kind: "partial",
      label: "Plus plan or higher",
      source: lensDoc("k8slens/argo-cd/", "\"Lens premium subscription feature.\" GitOps with Flux or Argo CD is first listed under the Plus plan on the pricing page."),
    },
    freelens: {
      kind: "partial",
      label: "Community extensions only",
      source: flMarketplace("Argo CD extensions exist from individual authors (not the freelensapp organisation); none is in the official marketplace list."),
    },
  },
  {
    feature: "Vulnerability (CVE) view",
    group: "paid-in-lens",
    kubebay: {
      kind: "yes",
      label: "Free: every CVE, one row per workload",
      source: kbDoc("vulnerabilities", "Reads Trivy-Operator's reports; offers to install Trivy-Operator with Helm when it's missing."),
    },
    lens: {
      kind: "partial",
      label: "Plus plan or higher: Security Center",
      source: lensDoc("k8slens/security-center/", "\"Premium subscription feature.\" Scans images, resources and Roles; needs Trivy Operator."),
    },
    freelens: {
      kind: "partial",
      label: "Community extensions only",
      source: flMarketplace("Trivy-Operator extensions exist from individual authors; none is official."),
    },
  },
  {
    feature: "Idle capacity and usage against requests",
    group: "paid-in-lens",
    kubebay: {
      kind: "yes",
      label: "Free: CPU and memory, by namespace, pod and node",
      source: kbDoc("cost-waste", "Works in CPU and memory, not money. Includes an efficiency score and p95 usage against requests."),
    },
    lens: {
      kind: "partial",
      label: "Premium: Cost Monitoring, by namespace",
      source: lensDoc("k8slens/cost-monitoring/", "\"Lens premium subscription feature.\" Costs by namespace over 24 hours, 7 or 30 days, and idle capacity."),
    },
    freelens: {
      kind: "partial",
      label: "GPU extension only; no general cost view documented",
      source: flMarketplace("The official GPU extension covers GPUs. " + flNote),
    },
  },
  {
    feature: "MCP server for AI assistants",
    group: "paid-in-lens",
    kubebay: {
      kind: "yes",
      label: "Free: off until you allow clusters; changes need your approval",
      source: kbDoc("ai-assistants", "Claude Desktop, Claude Code or another MCP client reads the clusters you tick; proposed changes are approved one by one."),
    },
    lens: {
      kind: "partial",
      label: "Plus or higher: built-in, read-only",
      source: lensDoc("k8slens/mcp-server/", "\"Plus, Pro, or Enterprise subscription plan\"; the pricing page ticks it from Plus. Runs read-only kubectl commands."),
    },
    freelens: {
      kind: "partial",
      label: "Extensions: AI and Claude chat clients, not an MCP server",
      source: {
        url: "https://github.com/freelensapp/freelens-ai-extension",
        checked: NOW,
        note: "Official extensions embed an AI agent in Freelens (Claude Code or MCP clients) with approval modes. No Freelens page describes the app serving MCP to outside assistants.",
      },
    },
  },
  {
    feature: "Audit log of changes you make",
    group: "paid-in-lens",
    kubebay: {
      kind: "yes",
      label: "Free, on your own machine",
      source: kbDoc("audit-log", "Lists what you did through Kubebay and every call an AI assistant made."),
    },
    lens: {
      kind: "partial",
      label: "Enterprise plan, per the pricing page",
      source: lensPricing("\"Audit logs\" is listed under the Enterprise plan. No Lens K8S IDE docs page describes what it records."),
    },
    freelens: notDocumented(flMarketplace(flNote + " An open feature request asks for a command log.")),
  },

  // --- Not described by Lens or Freelens -----------------------------------
  {
    feature: "NetworkPolicy matrix and \"can A reach B?\"",
    group: "undocumented",
    kubebay: {
      kind: "yes",
      label: "Connectivity matrix, coverage gaps, pair check",
      source: kbDoc("network-policy", "Evaluates the policies for an exact source and destination pod, and says which rule decides."),
    },
    lens: {
      kind: "partial",
      label: "A list of policies",
      source: lensDoc("k8slens/using-lens/network/network-policies/", "Columns Name, Namespace, Policy Types and Age, with Edit and Delete. No matrix, coverage view or reachability check is described."),
    },
    freelens: notDocumented(flMarketplace()),
  },
  {
    feature: "NetworkPolicy builder and live network test",
    group: "undocumented",
    kubebay: {
      kind: "yes",
      label: "Form with dry-run; helper-pod test",
      source: kbDoc("network-policy", "Builds a NetworkPolicy from a form and dry-runs it before creating; a live check runs a helper pod."),
    },
    lens: notDocumented(lensDoc("k8slens/using-lens/network/network-policies/", "The page describes editing and deleting a policy's YAML. No builder or connectivity test is described.")),
    freelens: notDocumented(flMarketplace()),
  },
  {
    feature: "Single points of failure",
    group: "undocumented",
    kubebay: {
      kind: "yes",
      label: "SPOF Radar: one replica without a PDB, replicas on one node",
      source: kbDoc("workloads-overview", "Also flags a Service with exactly one Ready backend."),
    },
    lens: notDocumented(lensSitemap("No page in the documentation sitemap covers single points of failure or disruption budgets.")),
    freelens: notDocumented(flMarketplace()),
  },
  {
    feature: "Node consolidation, spot risk, headroom forecast",
    group: "undocumented",
    kubebay: {
      kind: "yes",
      label: "Which nodes could drain, spot disruption risk, when headroom runs out",
      source: kbDoc("cost-waste", "The forecast and unusual-usage detection need recorded history: at least 5 days."),
    },
    lens: notDocumented(lensDoc("k8slens/cost-monitoring/using-cost-monitoring/", "Cost Monitoring shows namespace costs and idle capacity. No consolidation simulation, spot-risk check or forecast is described.")),
    freelens: notDocumented(flMarketplace()),
  },
  {
    feature: "Deprecated APIs before an upgrade",
    group: "undocumented",
    kubebay: {
      kind: "partial",
      label: "Removed APIs up to Kubernetes 1.29 that the cluster still serves",
      source: kbDoc("upgrade-readiness", "Reads the API server's discovery data against a fixed table of removals; the table stops at 1.29."),
    },
    lens: notDocumented(lensSitemap("No page in the documentation sitemap or the 2026 release notes covers API deprecations or upgrade readiness.")),
    freelens: notDocumented(flMarketplace()),
  },
  {
    feature: "Attack paths",
    group: "undocumented",
    kubebay: {
      kind: "yes",
      label: "Outside traffic, NetworkPolicy, CVEs and RBAC joined into chains",
      source: kbDoc("rbac", "Starts at a LoadBalancer, NodePort, Ingress or HTTPRoute; the CVE step needs Trivy-Operator."),
    },
    lens: notDocumented(lensDoc("k8slens/security-center/", "Security Center reports images, resources and Roles separately. No page joins them into paths.")),
    freelens: notDocumented(flMarketplace()),
  },
  {
    feature: "RBAC \"who can do this?\"",
    group: "undocumented",
    kubebay: {
      kind: "yes",
      label: "Pick a verb and a kind; see every subject and binding",
      source: kbDoc("rbac", "The Who can … explorer, next to findings for wildcards, escalation verbs, cluster-wide Secret reads and exec."),
    },
    lens: notDocumented(lensDoc("k8slens/security-center/roles/", "Security Center scans Roles and ClusterRoles. No page describes asking who can perform an action.")),
    freelens: notDocumented(flMarketplace("Core Freelens lists Roles and bindings. " + flNote)),
  },
  {
    feature: "Image-signature coverage checks",
    group: "undocumented",
    kubebay: {
      kind: "yes",
      label: "Detects Kyverno, Sigstore policy-controller, Ratify, Connaisseur",
      source: kbDoc("rbac", "Reports namespaces and images that no signature policy covers."),
    },
    lens: notDocumented(lensDoc("k8slens/security-center/", "Security Center covers vulnerability scanning; no page describes image-signature policies.")),
    freelens: notDocumented(flMarketplace()),
  },
  {
    feature: "Install a VPA recommender",
    group: "undocumented",
    kubebay: {
      kind: "yes",
      label: "Preview and typed confirmation, from Right-sizing",
      source: kbDoc("right-sizing", "Installs the upstream recommender only. Right-sizing then ranks workloads by waste, with a dry-run and one-click apply."),
    },
    lens: notDocumented(lensDoc("k8slens/using-lens/config/vertical-pod-autoscalers/", "The page lists VerticalPodAutoscalers; no install of a recommender is described.")),
    freelens: notDocumented(flMarketplace()),
  },
  {
    feature: "Themes, including high-contrast",
    group: "undocumented",
    kubebay: {
      kind: "yes",
      label: "12 themes; two high-contrast at 7:1, the rest at 4.5:1",
      source: kbDoc("settings", "Contrast is held by tests: themeContrast.test.ts in the shell."),
    },
    lens: {
      kind: "partial",
      label: "Dark, Light and sync with system",
      source: lensDoc("k8slens/using-lens/preferences/", "Theme options as documented in Preferences."),
    },
    freelens: {
      kind: "partial",
      label: "Dark, Light and sync with system",
      source: flMarketplace("Theme options as found in the app's source and releases; Freelens has no user manual. " + flNote),
    },
  },
];
