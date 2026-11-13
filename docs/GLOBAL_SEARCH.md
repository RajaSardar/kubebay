# Global search in ⌘K: can we, what would it cost, what should we build

> Backlog item 32. Researched 2026-11-13 against `main` at v0.7.0 + unreleased.
>
> **Status:** phase 1 and phase 2 are built (see the commits `feat(palette)` and `feat(engine): a search index`). §6 below is the design they follow, with these differences: the scope switch defaults to the current cluster; every built-in kind is searched, with the high-churn ones (Events, Leases, Endpoints, EndpointSlices, ControllerRevisions, report objects) on demand when a query names them; and custom resources from unfamiliar groups are on demand too, so nothing is out of reach. Phase 3 (field search, actions) is not started.
> Numbers marked **measured** were produced for this note with a throwaway benchmark; **estimated** means arithmetic from a measurement; **not measured** is said where it applies.

## 1. The question

⌘K should find everything: deployments, StatefulSets, Services, CRDs, anything, from anywhere. Is that possible, would building it hurt something, and what should we do?

## 2. Short answer

**Yes, it is possible, and it is a good fit for Kubebay.** Matching is cheap. What costs something is *knowing about every object*: memory and API-server watches for the kinds the app does not already follow. That cost is controllable, so build it in stages and start with the stage that adds almost nothing and removes a cost the palette already has.

1. **Now (small, low risk):** search the objects the app already holds in memory, across all connected clusters, and fix the palette's always-on cost. Details in §6, phase 1.
2. **Next:** an engine-side name index that follows more kinds lazily, per user identity. §6, phase 2.
3. **Later, if wanted:** labels, images, IPs and actions in the same box. §6, phase 3.

## 3. What the palette does today

`web/apps/shell/src/components/Palette.tsx`:

- Searches **navigation links** (pages and one link per resource *kind*), **saved views**, **clusters**, **active port-forwards**, and **live pods of the active cluster**.
- Plain substring match, no ranking, **8 results per section**.
- A pod result opens the Pods list filtered by name, not the pod itself. There is no result for a Deployment, Service, ConfigMap or any other object.

**A cost it already has.** `<Palette>` is mounted for the whole session (`App.tsx:616`), and its hooks run before the `if (!open) return null` line. `useLivePods` therefore keeps its own full-object `v1/pods` stream open on every page, holds a second in-browser copy of every pod, and re-derives a row for every pod on every stream flush, whether or not anyone ever presses ⌘K. This is separate from the engine's informer, which is shared. It is also relevant to backlog item 23 (the app feels heavy). *Its CPU cost was not measured.*

## 4. What others do

All checked 2026-11-12/13. None documents a search across kinds by name.

| Tool | What it has | Source |
|---|---|---|
| Lens | A filter box above each resource list (case-sensitive and regex options), and a separate Command Palette for tasks and cluster search. Search "executes only against the active list". | docs.lenshq.io/k8slens/using-lens/search-resource-lists/ ; …/getting-started/use-command-palette/ |
| Freelens | A command palette that finds clusters, port-forwards and sidebar pages (release notes v1.6.2, v1.10.3). | `docs/research/2026-11-12-lens-freelens/freelens-a.md`, F08 |
| k9s | `:` jumps to a kind, `/` filters the current view (regex, or fuzzy with `/-f`). "The documentation does not mention cross-kind resource searching." | k9scli.io/topics/commands/ |
| Headlamp | Nothing found on the docs page read; **not verified** either way. | headlamp.dev/docs/latest/ |

So a palette that jumps to any named object is a differentiator, not a catch-up.

## 5. Feasibility and cost

### 5.1 Matching is not the problem (measured)

A first-cut scorer (exact, prefix, word-start, substring, subsequence) over entries like `pod team-4/api-12-ab3`, run in the shell's test environment:

| Entries | Index build | Per keystroke (5 queries) |
|---|---|---|
| 10,000 | 2 ms | 2–4 ms |
| 50,000 | 14 ms | 6–12 ms |
| 100,000 | 20 ms | 17–27 ms |
| 250,000 | 92 ms | 45–99 ms |

Anything up to about 100,000 objects stays under one frame's worth of work per keystroke with a 60–80 ms debounce. Beyond that, search in the engine (Go is faster still) and send only the top hits.

### 5.2 Knowing about the objects is the cost

- A metadata-only informer cache costs about **1.3 KB per object** (measured: 64 MB for 50,000 `PartialObjectMetadata` with typical labels, annotations, owner and trimmed managed fields).
- A name index alone, with its own strings, is far smaller: about **80 bytes per entry**, so about 4 MB per 50,000 objects (*estimated*: a 40-byte struct plus the two strings; an attempt to measure it directly was discarded as unreliable).
- So the cost is **watching** more kinds, not storing names. Each extra kind is one LIST and one long-lived WATCH per cluster, per user identity.

What the app already follows per connected cluster (`clusterConnections.ts`): pods, deployments, StatefulSets, DaemonSets and Jobs in full, plus nodes and namespaces as metadata. Those can be searched for **no extra watches**. Services, Ingresses, ConfigMaps, Secrets, PVCs, ServiceAccounts, Roles, CRDs and custom resources are not followed unless their page is open.

### 5.3 The engine is well placed to do it

- Informers are shared and keyed by **user identity** (`informers/pool_registry.go`: `cluster|user|groups`), so an index fed from them sees exactly what that user may list. A kind RBAC forbids is already dropped by the pool's `forbid` path. No new permission logic is needed.
- Pool entries are evicted two minutes after the last subscriber leaves, so a lazily started index cleans itself up.
- Because metadata and full informers are separate pool entries, an index that asked for *metadata* pods would duplicate the pod informer the UI already keeps. It should subscribe in the same mode the UI uses for those five kinds.

## 6. Options and recommendation

| | A. Client only | B. Engine index | C. Query the API server per search |
|---|---|---|---|
| Covers | kinds the app already follows | any kind, opt-in lazily | any kind |
| Extra memory | none (shares caches) | ~80 B/object in the engine, plus informers for new kinds | none |
| Extra API load | none | one LIST+WATCH per added kind per identity | N LISTs on every search or open |
| First results | instant | instant for followed kinds; others after indexing (about a second) | slow, rate-limited |
| Works in web and in-cluster mode | yes | yes | yes |
| Verdict | **phase 1** | **phase 2** | rejected: load grows with each keystroke or open |

### Phase 1: client-side, no new watches

1. **Stop paying for the palette when it is closed.** Mount the list only when open, and read pod rows from the existing stream cache instead of opening another full pod stream.
2. **Search every followed object across all connected clusters**, not just pods of the active one: pods, Deployments, StatefulSets, DaemonSets, Jobs, nodes, namespaces.
3. **Open the object**, not a filtered list: `/detail/<slug>/<ns>/<name>`.
4. **Rank and group**: exact, prefix, word-start, substring; group by kind with a count; more than 8 rows; kind prefixes (`deploy api`, `ns:`); recents first when the box is empty; the cluster shown on each hit.
5. Debounce 60–80 ms; cap the work per keystroke.

Expected effect on the app: **less** work than today.

### Phase 2: an engine-side index

- A package that subscribes to the pool for a default set of kinds on **first ⌘K**, not at cluster connect, and lets the pool's eviction release it when idle.
- Default kinds: Services, Ingresses, ConfigMaps, Secrets (**names only**, never values), PVCs and PVs, ServiceAccounts, Roles and bindings, CRD definitions, plus the instances of allow-listed CRD groups (Argo CD, Flux, KEDA, Karpenter, Gateway API). Excluded by default: Events, EndpointSlices, Endpoints, Leases, ControllerRevisions, and bulky generated kinds such as Trivy reports. They stay reachable by typing the kind.
- `GET /api/search?cluster=&q=&kinds=&limit=` returns the top hits grouped by kind. The shell merges them with phase 1's local hits.
- Budgets: a cap on entries per cluster and per kind, and a footer saying "indexed N objects" so an incomplete index is visible, never silent.

### Phase 3 (optional)

Field search (`label:app=api`, `image:nginx`, `ip:10.1.2.3`), actions from the same box (`>scale`, `>restart`), saved searches.

## 7. Risks and how each is handled

| Risk | Handling |
|---|---|
| Engine memory climbs (it already reached 426–488 MB in use, against the 512 MiB soft limit) | Lazy start, allow-list, per-kind caps, eviction when idle, measured against the performance budgets before release. The index itself is small; the new informers are the cost. |
| Extra load on the API server | One watch per added kind, only after ⌘K is first used, none for kinds RBAC forbids. |
| Leaking what a user may not see | Informers are per identity and respect RBAC; a forbidden kind is skipped and said so. Secret *values* are never indexed. |
| Noisy results | Ranking, grouping, kind prefixes, a result cap per group. |
| Stale results | The index follows watch deltas; deletions disappear. |
| Huge CR counts (real clusters often list a hundred or more CRDs) | Index CRD *definitions* always, CR *instances* only for allow-listed groups or when the kind is typed. |
| Search that hides cost from the user | Show the count and any kinds that could not be indexed. |

## 8. Decision for the owner

1. Build **phase 1** first? It is small, adds no watches, and removes an existing cost.
2. Is the default kind set in phase 2 right, in particular **Secret names** and **allow-listed CRD instances**?
3. Should "search every connected cluster" be the default scope, or the active cluster with a toggle?

Tests that would gate the work (per the repo's rules): palette ranking and grouping; cross-cluster hits; "no extra stream when closed"; and, for phase 2, an engine test that a forbidden kind never enters the index and a benchmark that holds a time and memory budget at 100,000 objects.
