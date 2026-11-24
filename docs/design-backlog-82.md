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
