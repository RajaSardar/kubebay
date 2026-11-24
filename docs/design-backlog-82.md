# Design: desktop change timeline (backlog 82)

Status: design only. No implementation yet.

## Goal
A "Changes" page that shows what changed in a cluster over the last N days:
Kubernetes events and object changes, who changed it (field manager), and
honest "not recorded" bands where the app or a watch was not running. Data is
kept in one local SQLite file. Desktop only.

## Data sources
- Object changes: the shared informer pool (`engine/internal/informers`) already
  watches kinds and trims managedFields values (`trimManagedFields`). Add a
  change observer on update/delete/add events. It reads only metadata and the
  managedFields entry manager+operation+time, and computes a field-level diff
  summary (paths changed, never values) between old and new objects.
- Events: core/v1 Event objects from the same pool, stored as rows of kind
  `Event` with reason, type, involved object and a truncated message.
- Coverage: watch connect/disconnect callbacks plus engine start/stop markers.
- Kind Secret is dropped at the observer, before any diff is computed.

## Module layout
- `engine/internal/timeline/store.go`: SQLite open, WAL, migrations, insert, query, prune, size cap, corruption recovery.
- `engine/internal/timeline/diff.go`: pure `Summarize(old, new) []FieldChange` (paths and change kind only).
- `engine/internal/timeline/recorder.go`: bounded channel, batching (flush every 2 s or 500 rows), drop-and-count on overflow, coverage tracking.
- `engine/internal/timeline/gaps.go`: pure `Gaps(coverage []Span, from, to) []Gap`.
- `engine/internal/httpapi/timeline.go`: `TimelineAPI` plus `TimelineBlockReason(inCluster, oidc bool) string`.
- `engine/cmd/kubebay/main.go`: `setupTimeline(...)`, mirroring `setupHistory`.
- Web: `web/apps/shell/src/pages/Changes.tsx`, `lib/timeline.ts` (query building, band layout), Settings section, route in `App.tsx`, `help.ts` entry, `<PageHelp route="/changes" />`, website docs page with `appRoutes: ["/changes"]`.

## Public API and types
SQLite driver: `modernc.org/sqlite` (pure Go, keeps `CGO_ENABLED=0`). Before adding it, check `engine/go.mod` (go 1.26.0), `scripts/dependency-floors.test.mjs` and `scripts/engine-builds.test.mjs`, and measure binary growth (expected several MB) against `scripts/installer-sizes.mjs`; report the delta.

Schema (user_version = 1): `changes(id, cluster, ts, kind, group, version, namespace, name, uid, op, field_manager, summary_json, event_reason, event_type, message)`; `coverage(id, cluster, start_ts, end_ts, reason)`; `meta(key,value)`. Indexes on (cluster, ts), (cluster, kind, namespace, ts), (field_manager).

```go
type Change struct { ID int64; Cluster string; TS time.Time; GVK, Namespace, Name, UID, Op, FieldManager string; Fields []FieldChange; Reason, Type, Message string }
type FieldChange struct { Path, Kind string } // Kind: added|removed|changed
type Query struct { Cluster, Namespace, Kind, Manager string; From, To time.Time; Limit int; Cursor string }
type Gap struct { From, To time.Time; Reason string } // "engine not running" | "watch disconnected"
```
HTTP (all under `/api/timeline`, 403 with reason when blocked):
- `GET /api/timeline/status`: enabled, blockedReason, retentionDays, dbBytes, capBytes, dropped count.
- `GET /api/timeline/changes?cluster=&namespace=&kind=&manager=&from=&to=&limit=&cursor=`: `{changes, gaps, nextCursor}`.
- `GET /api/timeline/facets?cluster=`: distinct kinds, namespaces, managers.
- `PUT /api/timeline/settings` `{retentionDays: 0|1..30}` via the existing settings manager (default 7, max 30, 0 = off). `DELETE /api/timeline` clears data, audited.

## Security considerations
- Shared engine (in-cluster or OIDC): off with a reason, same pattern as `HistoryBlockReason`/`SharedSettingsBlockReason`. Settings are not stored there, so one user cannot enable or erase it for others. Add the call to the `sharedidentity_test.go` list and the authproxy test map.
- Records come from the desktop user's own kubeconfig identity, so they show no more than that user's RBAC. Namespaces the user cannot list or watch are simply not recorded (shown as coverage gaps, not errors).
- Never stored: Secret objects (any group/version), managedFields values (fieldsV1), field values in diffs, annotation values such as last-applied-configuration. Event messages are truncated (512 chars) and passed through `engine/internal/redact`.
- The DB file is mode 0600 in the user config dir, per-cluster rows keyed by cluster fingerprint like history.
- Clear-data and retention changes go through `audit.RecordCtx` with user and gvr; the existing confirmation dialog is used for clear.
- Bounded input: query limit capped (500), parameterised SQL only, filters validated.

## Test plan (TDD, temp DB per test)
- `diff_test.go`: Secret dropped; no values in output; ordering stable; managedFields-only changes yield manager but no field values.
- `store_test.go`: migrations from empty and v0; WAL pragma set; insert and filter by each facet; pagination; prune by retention; size cap evicts oldest; corruption recovery (garbage file renamed to `.corrupt-<ts>`, new DB created, status reports it).
- `recorder_test.go`: batching, overflow drop counter, write-rate bound, coverage open/close on disconnect, engine start writes a gap for downtime.
- `gaps_test.go`: merge and clip spans, edge cases at window bounds.
- `httpapi/timeline_test.go`: blocked on OIDC and in-cluster (403 with reason), validation errors, audit entries, no Secret in responses.
- Perf test: insert 100k rows, assert filtered, paginated query p95 under 50 ms (generous CI bound; skipped under `-short`).
- Web: `timeline.test.ts` (band layout), `Changes.test.tsx` (filters, gap band, row click opens the object, blocked state), help.test and docs.test guards, shellAdoption/themeTokens (gap band uses existing `--kb-*` tokens, no new colour planned).
- Scripts tests: engine-builds and dependency-floors with the new dependency.

## Failure modes
- Open or migrate fails: timeline unavailable with reason; engine keeps running, no crash.
- Corrupt DB: rename, recreate, record a gap, surface a notice in status.
- Disk full or size cap hit: oldest rows evicted first; if writes still fail, stop recording and show it in status.
- Event storms: bounded channel drops and counts; the page shows "N changes not recorded".
- Watch relist after a disconnect: initial list is not recorded as changes (resourceVersion/UID baseline only), and the span is marked a gap.
- Two engines on one DB: WAL plus a lock file like history; second becomes read-only.
- Clock jumps: rows use observed wall time; gaps clipped to monotonic order.

## Out of scope
- Shared/in-cluster/OIDC engines and any server-side or cross-user store.
- Storing field values, object bodies, Secrets, or restoring/diffing full manifests.
- Export, alerting, cross-machine sync, correlation with incidents.
- Backfilling history from before recording began (the page shows a "not recorded" band instead).
- Changing the existing usage-history store.

## Challenge round

Checked against `engine/internal/informers/pool.go`, `engine/internal/history/`, and `cmd/kubebay/sharedidentity_test.go`.

### Objections and resolved decisions

1. **The pool is not a continuous watcher (wrong assumption).** `pool.go` creates an informer entry lazily per (gvr, namespace) when a page subscribes, and stops it when subscribers leave. An observer hung on `AddEventHandler` only sees kinds the user happens to have open, and only while open. The plan implies a standing record of the cluster, so the "not recorded" bands would be wrong: they would show coverage where the watch ran for one page view.
   Decision: coverage is per (cluster, kind), not per cluster. The recorder opens a span when an informer for that kind starts and closes it when it stops or loses its watch. The page shows a band per selected kind and an "any kind" view that only claims coverage where all shown kinds are covered. v1 does NOT start its own background watches: that would list all namespaces of every kind on a user's cluster without their action, which is a load and RBAC-surprise change. Instead a Settings toggle "Keep watching these kinds while the app is open" (default off, small fixed allowlist: Deployment, StatefulSet, DaemonSet, Job, CronJob, Service, Ingress, ConfigMap, Node, Event) is v1.1. v1 ships passive recording plus honest per-kind bands. Docs must say so.

2. **Field-level paths cannot come from managedFields (wrong assumption).** `trimManagedFields` deletes `fieldsV1` as objects enter the cache, so the plan's "managedFields entry manager+operation+time" yields only the manager and a time, never which fields. Also `last-applied-configuration` is replaced with a constant, so it never shows as changed.
   Decision: field paths come from diffing old vs new cached objects (both are trimmed already, so no values leak through the trimmed parts), with the diff walking only to a depth cap (6) and a path count cap (50, then "+N more"). The manager is the managedFields entry with the newest `time` whose time is at or after the old object's newest. Where the kind is a metadata-only informer (`PartialObjectMetadata`), the diff covers metadata only (labels, annotation keys, finalizers, ownerRefs); the row says "metadata only" rather than implying nothing else changed.

3. **Noise will drown the signal (scope trap).** `UpdateFunc` fires on resync with an identical resourceVersion, and Pod status, Lease, Endpoints/EndpointSlice and Node heartbeat updates change every few seconds. The plan has only a drop-on-overflow guard.
   Decision: (a) skip when old and new resourceVersion are equal; (b) ignore changes whose only paths are `metadata.resourceVersion`, `metadata.generation` alone, `status.conditions[*].lastHeartbeatTime/lastTransitionTime-only`, `status.observedGeneration`, and managedFields time-only; (c) a denylist of kinds never recorded: Secret (any group), Lease, EndpointSlice, Endpoints, and `events.k8s.io` duplicates; (d) per-object coalescing: updates to the same UID within 30 s merge into one row (union of paths, latest manager). These are pure functions in `diff.go` and unit-tested with fixtures. The write-rate test asserts a 1000-update Node heartbeat storm yields at most a handful of rows.

4. **Reuse existing modules instead of inventing parallels.** The plan says "keyed by cluster fingerprint like history" and "lock file like history" but does not name them. Decision: reuse `history/fingerprint.go` for the cluster key and the `writer.lock` pattern/`ErrReadOnly` semantics from `history/store.go` (extract a tiny shared helper only if it is a pure move with the history tests unchanged; otherwise duplicate ~20 lines and note it). Redaction uses `engine/internal/redact` as planned. Settings use `SettingsManager`, and the page's blocked state reuses the `HistoryBlockReason` shape.

5. **SQLite dependency is a risk to the whole engine, not just this feature (untestable/scope).** The history package deliberately uses plain JSONL files, and the plan adds `modernc.org/sqlite` (several MB, large transitive set, a go 1.26 compatibility question) to the engine that also ships in-cluster and to the Helm image.
   Decision: keep SQLite, because the filtered, paginated, indexed queries and size-capped eviction are exactly its job and a hand-rolled JSONL index would be the larger risk. But: put it behind a `store` interface (`Append`, `Query`, `Prune`, `Stats`, `Clear`) so recorder, gaps and HTTP tests run against an in-memory fake and only `store_test.go` needs the real driver. Gate the work on a first, separate commit that adds the dependency and passes `go build` with `CGO_ENABLED=0`, `dependency-floors.test.mjs`, `engine-builds.test.mjs`, and reports the binary-size delta. If the delta exceeds 8 MB or the floors/builds tests need weakening, stop and fall back to the JSONL-segment design. The in-cluster image links the package but never opens a DB (blocked reason), which the `main.go` test must prove.

6. **Security hole: the HTTP API is readable by any local process and by other users on a shared engine if the block check is only at setup.** Decision: the block is enforced inside each handler as well as at `setupTimeline` (defence in depth, as the 403 tests already imply), and the handlers verify `cluster` is one the Manager currently knows, so a caller cannot read rows for a fingerprint the desktop user never connected. `DELETE /api/timeline` requires the existing CSRF/confirm header pattern used by other destructive routes (the implementer must find and match it, not add a new one). A `DELETE` takes an optional `cluster` so "clear this cluster" is possible without wiping everything; both are audited with the cluster in the record.
   Also: object names and namespaces are user data too. The 0600 file plus per-user config dir is the boundary; the docs state the file is not encrypted and is removed by "Clear" and by turning retention to Off (which also deletes the file, not just stops writing).

7. **Event messages and names can contain secrets (redaction gap).** Event messages sometimes echo env values or URLs with credentials. Decision: run messages through `redact` before truncation (redact then cut at 512 so a secret straddling the cut cannot survive), and add a test with a token-bearing message that straddles byte 512.

8. **Initial-list suppression conflicts with the plan's own failure mode.** `AddFunc` already gets `isInInitialList`; adds that are real creations arrive with `false`. But after a watch relist, objects deleted during the gap arrive as delete events with `DeletedFinalStateUnknown` and objects changed arrive as updates against stale old state, so the diff across a relist is a multi-change merge, not one change. Decision: unwrap `DeletedFinalStateUnknown`, record those deletes and updates with a flag `afterGap`, shown with a "during a gap" marker and never attributed to a single manager with confidence.

9. **Timestamps (clock jumps note is vague).** Decision: store `ts` as UTC unix milliseconds from `time.Now()` at observation, plus `obj_time` (the managedFields time or Event lastTimestamp) as a separate nullable column. The UI sorts by `ts`, shows `obj_time` on hover. Clock goes backwards: clamp so `ts` never decreases within one recorder (monotonic non-decreasing), tested with an injected clock. The recorder takes a `clock func() time.Time`.

10. **Scope trim for v1 (to keep slices shippable).** Slice order, each its own TDD commit: (1) dependency + store interface + SQLite store; (2) `diff.go` with noise rules; (3) `gaps.go`; (4) recorder with per-kind coverage; (5) HTTP + block reasons + audit + sharedidentity/authproxy test entries; (6) `setupTimeline` wiring into the pool observer; (7) web lib + page + Settings + help + docs + CHANGELOG. Dropped from v1: the `manager` facet endpoint beyond distinct values, the perf test as a CI gate (kept as `-short`-skipped, bound 200 ms, not 50 ms, to avoid a flaky gate), and the "keep watching" toggle (v1.1).

11. **Testability of the page.** `Changes.test.tsx` must assert the per-kind gap bands and the "N changes not recorded" dropped-count banner, not only filters. `timeline.ts` band layout is pure and takes `now` as an argument. The row click reuses the existing object-open helper (drawer/route used by search results) rather than a new navigation path.

12. **What cannot be verified here.** Behaviour against a real API server (relist, `DeletedFinalStateUnknown`, RBAC-forbidden namespaces) is covered by fake-clientset informer tests only. The CHANGELOG and docs must say it was not run against a live cluster, and that desktop-app persistence across restarts was tested with a temp-dir DB, not the packaged app.

### Net change to the plan
Coverage is per kind, not per cluster. Field paths come from old/new diffing, not managedFields. A noise filter and coalescing step is added. The SQLite dependency is gated and hidden behind a store interface, with a JSONL fallback if the cost is too high. The security section gains in-handler blocking, cluster-membership checks, a scoped delete, and redact-before-truncate. The work is split into seven slices.
