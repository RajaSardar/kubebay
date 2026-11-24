# Design: Issues queue with Investigate (backlog 76)

Status: design only. No implementation yet.

## Goal

One ranked list of what is wrong in the connected cluster, across kinds, so a
user sees "what do I look at first" without visiting six pages. Each issue has a
severity, kind/namespace/name, a one-line plain explanation, an age, and an
Investigate button that opens the object's drawer (or the page that holds the
evidence) with the same evidence the detector used. Ranked by severity, then
blast radius, then age. Filter by severity, kind and namespace. Per cluster.

The queue invents nothing: every issue carries the id of the detector that
raised it and the detector's own text. It adds no API calls; it reads the
streams and caches the existing pages already open.

## Data sources (existing detectors, reused as-is)

| Detector id      | Module                          | Input streams (already used elsewhere)            |
|------------------|---------------------------------|---------------------------------------------------|
| pod-problem      | lib/attention.ts findAttention (uses podReason; ExplainPod text for detail via lib/explainPod.ts) | pods, deployments, statefulsets, daemonsets, nodes |
| node-condition   | lib/attention.ts (node rows) and lib/pressure.ts | nodes |
| service-no-ready | lib/serviceSelectorMismatch.ts  | services, pods, endpointslices                    |
| spof             | lib/spof.ts computeSpofFindings | deployments, statefulsets, pdbs, pods, services, endpointslices |
| netpol-gap       | lib/networkPolicyCoverage.ts    | pods, networkpolicies, namespaces                 |
| best-practice    | lib/bestPractices.ts computeBestPractices, status "fail", severity Critical only | the BestPractices page's streams |
| upgrade-readiness| lib/upgradeReadiness.ts         | server version plus discovery (react-query "apis" key, already cached) |
| cert-expiry      | best-practice check "cert-expiry" (only when cert-manager group is served) | certificates |
| rbac-risk        | RBAC findings from the engine (api RBACFinding), non-system only via lib/rbacFindings.ts | existing react-query cache of the RBAC page |

Rule: a detector whose input stream is not synced, forbidden or not served
contributes nothing and is reported as "not checked" (see failure modes). It is
never treated as "no issues".

Streams are opened through `useResourceStream` with the same arguments and
`mode` the existing pages use so the shared stream cache (lib/streamCache.ts)
is hit. Optional streams (services, endpointslices, pdbs, netpols, certs) are
`enabled` only while /issues is mounted.

## Module layout

- `web/apps/shell/src/lib/issues.ts` (pure, no React, no fetch): types,
  adapters from each detector's output to `Issue`, `rankIssues`,
  `filterIssues`, `summarizeIssues`, `issueTarget`.
- `web/apps/shell/src/lib/useIssues.ts`: thin hook `useIssues(cluster)`;
  opens the streams, memoises inputs on `rows/synced/forbidden` (same pattern as
  pages/BestPractices.tsx), calls `computeIssues`, returns the result. The only
  non-pure file; kept free of UI so desktop notifications can import it later.
- `web/apps/shell/src/pages/Issues.tsx`: page. `DataTable`, `FilterBar`
  style inputs, status pills and buttons from `@kubebay/ui` only; `--kb-*`
  tokens only; `<PageHelp route="/issues" />`.
- Wiring: `<Route path="/issues">` in App.tsx, a nav link under Tools,
  an entry in the palette's page list, an entry in `lib/help.ts` (170-char limit),
  docs page `website/src/content/docs/issues.md` with `appRoutes: ["/issues"]`,
  CHANGELOG [Unreleased] under Added, then `node scripts/whatsnew-gen.mjs`.

## Public API and types

```ts
export type IssueSeverity = "critical" | "high" | "medium" | "low";
export type IssueDetector =
  | "pod-problem" | "node-condition" | "service-no-ready" | "spof"
  | "netpol-gap" | "best-practice" | "upgrade-readiness" | "cert-expiry" | "rbac-risk";

export interface Issue {
  id: string;            // stable: `${detector}|${kind}|${namespace}|${name}|${code}`
  cluster: string;
  detector: IssueDetector;   // the module that raised it, shown in the UI
  code: string;          // detector's own code, e.g. "CrashLoopBackOff"
  severity: IssueSeverity;
  kind: string;          // "Pod", "Deployment", "Node", "Service", ...
  namespace: string;     // "" for cluster-scoped
  name: string;
  summary: string;       // one plain line, detector's wording
  since?: number;        // ms epoch when known; age = now - since
  blast: number;         // affected pods/endpoints/workloads, >= 1; see ranking
  evidence: IssueEvidence;   // everything Investigate needs, no fetches
}
export type IssueEvidence =
  | { open: "object"; slug: string; ns: string; name: string }   // -> targetFor()
  | { open: "route"; path: string; search?: string };            // page holding the evidence

export interface IssueInputs { /* optional arrays per stream + serverVersion,
  apiGroups, rbacFindings; undefined means "not checked" */ now?: number }
export interface IssuesResult {
  issues: Issue[];                      // ranked
  notChecked: { detector: IssueDetector; reason: "loading" | "forbidden" | "not-served" }[];
  counts: Record<IssueSeverity, number>;
}
export function computeIssues(cluster: string, input: IssueInputs): IssuesResult;
export function rankIssues(issues: Issue[], now: number): Issue[];
export function filterIssues(issues: Issue[], f: { severity?: IssueSeverity[]; kind?: string[]; namespace?: string[] }): Issue[];
export function issueTarget(i: Issue): string;   // router path for Investigate
export function useIssues(cluster: string | undefined): IssuesResult & { loading: boolean };
```

Severity mapping (documented in code and docs): attention "err" -> high
(critical when a whole workload has 0 ready), "warn" -> medium; node NotReady
-> critical; pressure -> medium; service with zero ready endpoints -> high;
SPOF -> medium; NetworkPolicy gap -> low (medium when namespace has no policy
and pods exist); best-practice Critical -> critical; upgrade-readiness removed
API within 1 minor -> high, else medium; cert expired -> critical, near expiry
-> high; RBAC risk -> high for cluster-admin/wildcard, else medium.

Ranking: severity desc, then `blast` desc, then age desc (older first), then
`id` for a stable order. Blast = broken pod count for a workload, ready pods
behind a service, workloads on a node, namespace pod count for a netpol gap,
1 otherwise. Duplicates across detectors for one object are kept (different
detector, different evidence) but grouped adjacent via the sort tie-break.

Investigate target: object issues go through `targetFor()` in lib/objectPath.ts
(pods open `/workloads?pod=ns/name`, others `/detail/<slug>/<ns>/<name>`); page
issues go to the owning page (`/best-practices`, `/upgrade-readiness`, `/rbac`,
`/network-policy`) so the evidence is visible there.

## Security considerations

- Reads only what the user's own RBAC already streams. A forbidden stream marks
  its detectors "not checked"; the queue never shows data for it.
- No new endpoints, no extra API calls, no mutations, so no audit path change.
- No Secret values: the queue never opens a secrets stream. Cert issues use
  Certificate (cert-manager) status only, not the Secret.
- Per-user on a shared engine: all state is derived client-side from the user's
  own streams. Nothing is persisted server-side. Filter state is URL/local only.
- RBAC findings come from the existing per-user cached query, not a new call.
- Summaries are plain text rendered as text (no HTML), since object names and
  event messages are user-controlled.

## Test plan (TDD, tests first)

- `lib/__tests__/issues.test.ts`: one adapter test per detector (fixture in,
  exact Issue out, including detector id and evidence target); severity mapping
  table; ranking (severity, blast, age, id tie-break, stability); filters
  (each, combined, empty); counts; "not checked" for unsynced, forbidden and
  not-served inputs vs a genuinely clean cluster; cluster-scoped objects with
  empty namespace; `issueTarget` for pod, deployment, node, route issues;
  no issue without a detector id (property-style check over a mixed fixture).
- `lib/__tests__/issuesScale.test.ts`: 2,000 pods (plus proportional
  workloads, services, endpointslices, 50 nodes, 100 namespaces) with ~10% broken;
  `computeIssues` under a generous budget in the style of attackPathsScale.test.ts,
  and linear-growth sanity (4,000 pods not worse than ~3x).
- `lib/__tests__/useIssues.test.tsx`: renderHook with mocked streams: loading,
  synced, cluster switch resets, no extra stream beyond the listed set.
- `pages/__tests__/Issues.test.tsx`: rows render in rank order, filters narrow,
  Investigate navigates to the expected path, empty state, not-checked banner.
- Guard tests stay green: shellAdoption, themeTokens, themeContrast, cssHygiene,
  help.test (route entry, 170 chars), website docs.test (appRoutes), palette test.
- Headless Playwright mock harness screenshot into /tmp/kubebay-work/ only.

## Failure modes

- Stream still loading: show issues found so far with a "Still checking N
  sources" line; never "All clear" until every enabled detector is synced.
- Forbidden or CRD not served: listed under "Not checked" with the reason.
- Huge clusters: computation memoised on stream row identity; capped render
  (virtualised `DataTable`), full count still shown.
- Detector throws: caught per detector, that detector goes to "not checked",
  the rest still render.
- Cluster switch mid-render: results keyed by cluster, stale ones dropped.
- Object disappears before click: Investigate lands on the normal not-found
  state of the drawer/route.

## Out of scope

- Desktop notifications, alerting, or any background polling (later item;
  `useIssues` is the reuse point).
- Muting, acknowledging, assignment, or persistence of issues.
- New detectors or changing existing detector thresholds.
- Multi-cluster merged view (the queue is per cluster; fleet rollup is later).
- Auto-remediation or any mutation from the queue.
- Metrics-based issues (needs Prometheus), vulnerability and image findings.
