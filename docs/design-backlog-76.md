# Design: Issues queue with Investigate (backlog 76)
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
## Failure modes
- Stream still loading: show issues found so far with a "Still checking N
  sources" line; never "All clear" until every enabled detector is synced.
- Forbidden or CRD not served: listed under "Not checked" with the reason.
- Huge clusters: computation memoised on stream row identity; capped render
  (virtualised `DataTable`), full count still shown.
- Detector throws: caught per detector, that detector goes to "not checked",
  the rest still render.
## Out of scope
- Desktop notifications, alerting, or any background polling (later item;
  `useIssues` is the reuse point).
- Muting, acknowledging, assignment, or persistence of issues.
- New detectors or changing existing detector thresholds.
- Multi-cluster merged view (the queue is per cluster; fleet rollup is later).
- Auto-remediation or any mutation from the queue.

## Challenge round

Checked against the code in `web/apps/shell/src/lib` and `App.tsx`. Each
objection ends with a decision. These decisions replace the original text
wherever they differ.

### 1. "No API calls" is false for two detectors
- `lib/pressure.ts` is not a node-condition detector. `aggregatePressure` joins
  `PodUsage` (metrics from an engine call) with requests. Using it would add a
  call and make "node-condition" depend on metrics-server.
- The `rbac` query (`["rbac", cluster]` in `pages/Rbac.tsx`) is an engine-side
  cluster scan. It is only cached if the user has already visited /rbac, so
  `/issues` would show "not checked" for most people, or trigger a heavy fetch.
- Decision: drop `lib/pressure.ts` from the node detector. Node issues come
  from the nodes stream only: the Ready condition, plus MemoryPressure,
  DiskPressure, PIDPressure and NetworkUnavailable (medium), with
  `lastTransitionTime` as `since`. Drop `rbac-risk` from v1 and list it under
  Out of scope. Best-practice already covers the worst RBAC-adjacent checks.
  Reword the guarantee to "no new endpoints and no new mutations". `upgrade-readiness`
  may use the existing `["apis"]` and version queries with their existing
  keys, because both are cheap and read-only. If the data is absent and the
  fetch fails, the detector is "not checked".

### 2. cert-expiry is not derivable from the best-practice check
The `cert-expiry` check returns offender names only, with fixed severity
"High". It cannot tell expired from near-expiry, and the plan's own filter
(best-practice "Critical only") would exclude it. The plan listed both and
contradicted itself.
- Decision: extract a pure `certificateState(cert, now)` into
  `lib/certExpiry.ts` returning `expired | expiring | not-ready | ok`. The
  best-practice check calls it (a refactor covered by its existing test, which
  stays green), and the Issues adapter uses it directly. Severity: expired or
  not Ready critical, within 14 days high. The `cert-expiry` check id is
  excluded from the generic best-practice adapter to avoid duplicates.

### 3. Best-practice exceptions must be honoured
`lib/bestPracticesExceptions.ts` stores per-cluster, per-browser waivers
(`applyExceptions`). The plan would resurface findings the user has
deliberately accepted, which makes the queue noisy and untrusted.
- Decision: the best-practice adapter runs `applyExceptions` with
  `loadExceptions(cluster)` first and drops waived checks and namespaces. Test:
  a waived namespace yields no issue. Waivers are local, so the shared-engine
  per-user rule holds.

### 4. Ranking mixes incomparable "blast" numbers
Blast for a netpol gap is the namespace pod count, and for a crashing workload
it is its broken pods. Within one severity, a 500-pod namespace with no policy
would outrank an actively failing workload. Posture issues also have no `since`,
and "older first" is undefined for them.
- Decision: rank by severity, then `tier` (0 = something is failing now:
  pod-problem, node-condition, service-no-ready, cert-expiry; 1 = latent risk or
  hygiene: spof, netpol-gap, best-practice, upgrade-readiness), then `blast`,
  then age (a missing `since` sorts last), then `id`. Tier is derived from the
  detector in one table in `issues.ts` and is tested. Blast for netpol-gap is
  capped at 1 (the namespace is one item). It is not the pod count.

### 5. Scope trap: nine adapters in one commit
The posture detectors need 10 or more extra full streams (pods, deployments,
statefulsets, pdbs, netpols, namespaces, services, pvcs, nodes, certificates,
hpas) and are the bulk of the risk and review.
- Decision: ship in two vertical slices, each with tests, docs and a commit.
  Slice 1: the page, route, help, docs, `useIssues`, and the "failing now" tier
  (pod-problem, node-condition, service-no-ready, cert-expiry). Slice 2: the
  latent-risk tier (spof, netpol-gap, best-practice Critical,
  upgrade-readiness). `IssueDetector` lists all of them from the start, so slice
  2 only adds adapters. The page works with "not checked" for tier 1 meanwhile.

### 6. Compute and memoise per detector
A single `computeIssues` would re-run every detector on each pod stream tick.
- Decision: expose `detectors: Record<IssueDetector, (input) => Issue[]>`.
  `computeIssues` is the composition (each call wrapped in try/catch, which
  gives the "detector throws" failure mode a unit test). `useIssues` memoises
  each detector on only its own streams' `rows`, so a pod tick does not
  recompute spof or best-practice.

### 7. Investigate target for workload-level pod issues
`findAttention` groups by owner, so the issue is "Deployment/ns/web" but the
evidence is pods. `targetFor` for a Deployment opens the detail drawer without
the failing pod.
- Decision: pod-problem issues keep the workload as kind and name, and carry
  `evidence: { open: "object", slug: "pods", ns, name: row.pods[0] }` (the worst
  pod, most restarts first, from `AttentionRow.pods`). Investigate opens the
  pod through `targetFor`. The drawer from the workload row is a secondary
  action that is not in this item. A node-owned reason (`row.node`) is included
  in the summary and not a separate issue. Kind to slug uses the existing
  resource registry. Do not hand-write a map. The implementer must confirm
  which helper this repo has (see `lib/objectPath.ts` callers) and reuse it.

### 8. Page-level Investigate must not need page changes
"Open the page that holds the evidence" implies a deep link (`?check=...`) that
`BestPractices.tsx` may not read.
- Decision: v1 route targets carry only a path, with an optional `search` limited
  to params the target page already reads (verified in the test by importing
  the page's param name, or omitted). No page edits in this item. If a page
  lacks the param, the Investigate link opens the page unfiltered. Say so in
  the docs.

### 9. Namespace-restricted users
Pages scope streams with `opts.ns` for users with only namespace-level RBAC.
The plan opens cluster-wide streams, so a restricted user would see every
detector "not checked" and no issues.
- Decision: `useIssues` takes the same allowed-namespace scoping the other
  pages use for the same streams (find it via `useResourceStream` callers in
  `WorkloadsOverview.tsx`). The hook test covers a scoped call. Forbidden
  remains "not checked", never "all clear".

### 10. Test plan gaps
- The scale test needs a warm-up run and a ratio check (4,000 vs 2,000 pods)
  rather than only an absolute budget, or it joins the known timing flakes.
- Add a test that `Issue.summary` is passed through verbatim and rendered as
  text (a name like `<img onerror>` stays literal).
- Add a test that two clusters never share state: `useIssues` on a cluster
  switch drops the previous issues in the same render, not after the new
  streams sync.
- Add a regression test that `certificateState` refactoring leaves the
  best-practice `cert-expiry` result unchanged.

### Final decisions (summary)
1. Streams only. No `pressure.ts`, no RBAC, no new endpoints. Upgrade uses the
   existing cached queries.
2. New `lib/certExpiry.ts`, shared with best-practice.
3. Honour best-practice exceptions.
4. Rank by severity, tier, blast (netpol capped at 1), age (missing last), id.
5. Two slices: "failing now" first, then "latent risk".
6. Per-detector functions and memoisation, with try/catch isolation.
7. Pod issues investigate the worst pod, not the workload.
8. Route targets are path-only unless the page already reads the param.
9. Namespace scoping matches existing pages.
10. Extra tests: scale ratio, text-only rendering, cluster-switch reset, cert
    refactor regression.
