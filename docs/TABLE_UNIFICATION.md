# One table: unifying Pods with ResourceTable

Decision record for finding #18 in `TABLE_UX_RESEARCH.md` ("two table
implementations drift apart"). Decided 2026-09-30 after a three-way design
debate with a cross-examination round (CLAUDE.md multi-agent debate rule).

## Why

The Pods table (`pages/Workloads.tsx`) and every other table
(`pages/ResourceTable.tsx`) were separate implementations. Every table feature
was built twice, and they drifted in about a dozen places (count placement,
empty wording, hover, dimmed terminating rows, row-menu label, default sort,
filter fields, busy/live flags). On 2026-09-29 two PRs both edited
`Workloads.tsx` and the conflict resolution silently reverted one of them
(#39's virtualisation, restored in #41).

## Options argued

- **A. Full unification by config.** Pods becomes a `ResourceDef` (column set,
  row derivation, drawer, row menu, extra queries) rendered by ResourceTable;
  `Workloads.tsx` is deleted.
- **B. Shared list component.** Extract one `<ResourceListView>`; both pages
  become thin callers passing columns, drawer and menu items.
- **C. Headless hooks.** Share behaviour as hooks; each page keeps its own JSX.

## Verdict: B, reached through C's hook, with A's column type

- **Endpoint: one `components/ResourceListView.tsx`.** It owns everything a
  table row looks and behaves like: select, Name, namespace pill, Age
  (`LiveAge`), kebab; the header count; bulk delete with the GitOps warning
  and policy-rejection card; skeleton (on the unfiltered count) and empty
  states; `TableWrap busy`; resizable headers; virtualised rows; keyboard;
  hover; dimmed terminating rows; the context menu.
- **Behaviour core: `lib/useResourceList.ts`**, a pure hook tested with
  `renderHook` (filter, sort, selection, keyboard, virtualiser).
- **Columns: `ListColumn<R> { id, header, width, cell, sortValue?, filterText? }`**
  (A's column spec). Typed sort values fix the string sort ("10" < "9").
- **Per-kind behaviour stays in page code, not in `ResourceDef`.**
  `ResourceDef` stays plain data. `Workloads.tsx` keeps what is genuinely
  pod-specific: the metrics query, `derivePod` status, the CPU/memory meters,
  the Logs/Shell menu items and `PodPanel`. `ResourceTable.tsx` keeps the def
  lookup, the `extraColumns` → `ListColumn` adapter, printer columns, Owner,
  the node extras (moved to a hook), `GenericDrawer`, Scale/Restart and the
  create button.

### Rejected, and why

- **A's hooks, drawer and row menu inside `ResourceDef`:** it turns eight data
  fields into a plugin system whose hooks switch per slug; the nodes-only
  queries already inside ResourceTable show how that pattern ages. Deleting
  `Workloads.tsx` and flipping the route in one PR also breaks guard tests and
  the virtualisation test at once.
- **C as the endpoint:** the drift of #18, and the #39 revert, live in the
  rendered JSX; hooks alone leave two JSX trees for every future feature.
- **Guard tests are never weakened:** where JSX moves into the view, the view
  is added to the positive assertions, the negative assertions stay on both
  pages, and a new assertion requires each page to render `<ResourceListView`.

## Slices

Each is one PR that merges on its own and starts from a failing test.

1. Remove the never-routed pod branch from ResourceTable and GenericDrawer. *(refactor)*
2. Move `fmtCpu`/`fmtBytes` to `lib/format.ts`. *(refactor)*
3. Move `derivePod` to `lib/pods.ts`. *(refactor)*
4. Numeric and natural sort in every table. *(behaviour, approved)*
5. `useResourceList`; ResourceTable adopts it. *(refactor)*
6. Extract `<ResourceListView>` from ResourceTable; node extras to a hook. *(refactor)*
7. Pods onto the view: count in the header, dimmed terminating pods, mouse
   hover, one empty-state wording. *(behaviour, approved)*
8. ResourceTable: kebab named "Actions for …", filter matches every visible
   column. *(behaviour)*
9. Remove the Pods toolbar cluster picker (#28). *(behaviour, approved)*

Afterwards the column chooser (#21), changed-row tint (#24), filter syntax
(#25), bulk-action bar (#26) and sticky Name (#27) each land once, in the view.
