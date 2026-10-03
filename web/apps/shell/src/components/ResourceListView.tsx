import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge, Button, ColumnChooser, EmptyState, IconButton, InlineBanner, NsPill, PageHeader, SelectAllHeader, SelectCell, SelectionBar, SkeletonTable, SortHeader, Table, TableRow, TableWrap, TextField, VisuallyHidden } from "@kubebay/ui";
import { shouldShowSkeleton } from "../lib/useResourceStream";
import { useColumnWidths } from "../lib/useColumnWidths";
import { useColumnPrefs } from "../lib/useColumnPrefs";
import { useRowSelection } from "../lib/useRowSelection";
import { useBulkDelete, type DeleteTarget } from "../lib/useBulkDelete";
import { useResourceList } from "../lib/useResourceList";
import { matchesQuery, parseQuery, type Query } from "../lib/filterQuery";
import { useChangedRows } from "../lib/useChangedRows";
import { ROW_HEIGHT, useDisplay } from "../lib/display";
import { ownerAmongTargets, ownerLabel, ownerWarning } from "../lib/gitops";
import { absoluteTime, compareValues, countLabel, TYPING } from "../lib/tableUx";
import { useNamespaceStore } from "../lib/namespace-store";
import { VirtualSpacer } from "./VirtualSpacer";
import { LiveAge } from "./LiveAge";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { PolicyRejectionCard } from "./PolicyRejectionCard";

/** One of the page's own columns, between Namespace and Age. */
export interface ListColumn<R> {
  id: string;
  header: string;
  /** Initial width in px (110 when unset). */
  width?: number;
  cell: (r: R) => ReactNode;
  /** What the column sorts by; numbers sort as numbers. Unset: it does not reorder. */
  sortValue?: (r: R) => string | number;
  /** What the filter matches in this column. Unset: the filter skips it. */
  filterText?: (r: R) => string;
  /** The key that targets this column in the filter (`status:crash`). Needs filterText. */
  filterKey?: string;
  /** Hidden until the user shows it from the column chooser. */
  defaultHidden?: boolean;
  /** The cell's class ("mono muted" when unset). */
  className?: string | ((r: R) => string);
  /** The cell's tooltip. */
  title?: (r: R) => string | undefined;
}

export interface ResourceListViewProps<R> {
  title: ReactNode;
  /** Muted text after the title ("· Pods"). */
  titleCount?: ReactNode;
  /** Plural name, "Deployments": filter, delete and empty-state wording. */
  label: string;
  rows: readonly R[];
  /** The raw objects behind the rows, to find a GitOps owner before a delete. */
  objects: readonly Record<string, unknown>[];
  synced: boolean;
  /** Rows on screen but the stream is re-syncing: the thin progress bar. */
  busy: boolean;
  live: boolean;
  cluster: string;
  /** Cluster-scoped kind: no Namespace column. */
  scoped?: boolean;
  /** A namespace filter is on (for the empty-state hint). */
  nsFiltered: boolean;
  nameOf: (r: R) => string;
  nsOf: (r: R) => string;
  createdOf: (r: R) => string;
  isDimmed?: (r: R) => boolean;
  /** The object's labels, for `label:app=web` in the filter. */
  labelsOf?: (r: R) => Readonly<Record<string, string>> | undefined;
  /** The object's resourceVersion: a row whose shown values change briefly tints. Unset: no tint. */
  versionOf?: (r: R) => string;
  columns: readonly ListColumn<R>[];
  /** Where the chosen sort is remembered ("r/deployments"). */
  sortKey: string;
  /** Order when no column is sorted (by name when unset). */
  defaultSort?: (a: R, b: R) => number;
  /** The filter's placeholder ("Filter <label>…  /" when unset). */
  filterPlaceholder?: string;
  /** The filter's text when the list first renders (a link's ?q=). */
  initialFilter?: string;
  onOpen: (r: R) => void;
  /** The row menu; Delete goes through `requestDelete` to get the confirmation. */
  menuItems: (r: R, actions: { requestDelete: () => void }) => MenuItem[];
  onDelete: (t: DeleteTarget, gitopsOwner?: string) => Promise<unknown>;
  /** Controls placed before the filter field (namespace filter). */
  toolbar?: ReactNode;
}

/** "api, etl, run-0, run-1, run-2 +4 more, across 3 namespaces": what a bulk delete hits. */
function deletePreview(targets: readonly DeleteTarget[]): ReactNode {
  const shown = targets.slice(0, 5);
  const more = targets.length - shown.length;
  const namespaces = new Set(targets.map((t) => t.ns).filter(Boolean));
  return (
    <>
      {shown.map((t, i) => (
        <span key={`${t.ns}/${t.name}`}>
          {i > 0 && ", "}
          <strong className="mono">{t.name}</strong>
        </span>
      ))}
      {more > 0 && ` +${more} more`}
      {namespaces.size > 1 ? `, across ${namespaces.size} namespaces` : namespaces.size === 1 ? ` in ${[...namespaces][0]}` : ""}
    </>
  );
}

const NAME_W = 240;
const NS_W = 120;
const AGE_W = 75;
const COL_W = 110;

/**
 * The one resource list: header count, bulk delete, filter, sort, selection,
 * keyboard, virtualised rows, skeleton and empty states, row menu. Pages pass
 * their columns, row menu and drawer; see docs/TABLE_UNIFICATION.md.
 */
export function ResourceListView<R>(p: ResourceListViewProps<R>) {
  const { rows: all, nameOf, nsOf, columns, onOpen } = p;
  const { density } = useDisplay();
  const { setNamespaces } = useNamespaceStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; row: R } | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // Every column the user may show, hide or move (all but Name, which stays
  // first), in the page's order, and the user's layout of them (#21).
  const managed = useMemo(
    () => [
      ...(p.scoped ? [] : [{ id: "Namespace", header: "Namespace" }]),
      ...columns.map((c) => ({ id: c.id, header: c.header, defaultHidden: c.defaultHidden })),
      { id: "Age", header: "Age" },
    ],
    [p.scoped, columns],
  );
  const prefs = useColumnPrefs(p.sortKey, managed);
  const visibleIds = useMemo(() => new Set(prefs.visible), [prefs.visible]);
  // The shown columns as {id, header}: Name, then the user's order. Widths and
  // sort are keyed by id, so they stay with their column.
  const heads = useMemo(() => {
    const byId = new Map(managed.map((m) => [m.id, m.header]));
    return [{ id: "Name", header: "Name" }, ...prefs.visible.map((id) => ({ id, header: byId.get(id) ?? id }))];
  }, [managed, prefs.visible]);
  const headers = useMemo(() => heads.map((h) => h.header), [heads]);
  const defaultWidths = useMemo(
    () => ({ Name: NAME_W, Namespace: NS_W, Age: AGE_W, ...Object.fromEntries(columns.map((c) => [c.id, c.width ?? COL_W])) }),
    [columns],
  );
  const { widthOf, getResizeHandleProps } = useColumnWidths(defaultWidths);
  const widths = heads.map((h) => widthOf(h.id));
  const { selectedKeys, toggleRow, selectAll, clearAll, deselect, isAllSelected, isIndeterminate } = useRowSelection();
  const bulkDelete = useBulkDelete((t) => {
    const owner = ownerAmongTargets([t], [...p.objects]);
    return p.onDelete(t, owner ? ownerLabel(owner) : undefined);
  });

  const keyOf = useCallback((r: R) => `${nsOf(r)}/${nameOf(r)}`, [nsOf, nameOf]);

  // A selection belongs to one table and to rows that exist. Every /r/:kind
  // table is the same mounted view, so switching kinds must clear it, or
  // "Delete 1 selected" would hit the other kind's object of the same name.
  // An open delete confirmation goes with it: confirming it on the new kind
  // would delete that kind's objects.
  const cancelDelete = useRef(bulkDelete.cancel);
  cancelDelete.current = bulkDelete.cancel;
  useEffect(() => {
    clearAll();
    cancelDelete.current();
  }, [p.sortKey, clearAll]);
  // Rows the stream removed leave the selection (only once synced: a re-sync
  // briefly holds no rows and must not drop it).
  useEffect(() => {
    if (!p.synced || selectedKeys.size === 0) return;
    const present = new Set(all.map(keyOf));
    const gone = [...selectedKeys].filter((k) => !present.has(k));
    if (gone.length > 0) deselect(gone);
  }, [all, keyOf, p.synced, selectedKeys, deselect]);
  // What a row shows, as one string: a new resourceVersion tints the row only
  // if this changed too (a Node heartbeat changes nothing the table shows).
  const signatureOf = useCallback(
    (r: R) => columns.map((c) => String(c.sortValue?.(r) ?? c.filterText?.(r) ?? "")).join("\u0000"),
    [columns],
  );
  const changedKeys = useChangedRows(all, keyOf, p.versionOf, signatureOf, p.synced);
  const byCol = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const createdOf = p.createdOf;

  // The filter language (lib/filterQuery): plain words, ns:/name:/label:, and
  // each column's filterKey. Parsed once per filter string, not per row.
  const columnKeys = useMemo(() => columns.flatMap((c) => (c.filterKey && c.filterText ? [c.filterKey] : [])), [columns]);
  const parsed = useRef<{ q: string; query: Query } | null>(null);
  const labelsOf = p.labelsOf;
  const match = useCallback(
    (r: R, q: string) => {
      if (parsed.current?.q !== q) parsed.current = { q, query: parseQuery(q, columnKeys) };
      // Plain words search what is shown; key:value reaches any column.
      const fields: Record<string, string> = { name: nameOf(r), ns: nsOf(r) };
      const text = [fields.name!];
      if (visibleIds.has("Namespace")) text.push(fields.ns!);
      for (const c of columns) {
        if (!c.filterText) continue;
        const v = c.filterText(r);
        if (visibleIds.has(c.id)) text.push(v);
        if (c.filterKey) fields[c.filterKey.toLowerCase()] = v;
      }
      return matchesQuery({ text, fields, labels: labelsOf?.(r) }, parsed.current.query);
    },
    [columns, columnKeys, nameOf, nsOf, labelsOf, visibleIds],
  );

  const list = useResourceList<R>({
    rows: all,
    initialFilter: p.initialFilter,
    keyOf,
    match,
    // A hidden column no longer orders the table.
    sortable: useCallback((col: string) => col === "Name" || visibleIds.has(col), [visibleIds]),
    filterFields: useCallback(
      (r: R) => [nameOf(r), nsOf(r), ...columns.flatMap((c) => (c.filterText ? [c.filterText(r)] : []))],
      [nameOf, nsOf, columns],
    ),
    sortValue: useCallback(
      (r: R, col: string): string | number => {
        if (col === "Name") return nameOf(r);
        if (col === "Namespace") return nsOf(r);
        if (col === "Age") {
          const ts = createdOf(r);
          return ts ? Math.max(0, Date.now() - Date.parse(ts)) : 0;
        }
        return byCol.get(col)?.sortValue?.(r) ?? "";
      },
      [nameOf, nsOf, createdOf, byCol],
    ),
    defaultSort: useCallback(
      (a: R, b: R) => (p.defaultSort ? p.defaultSort(a, b) : compareValues(nameOf(a), nameOf(b))),
      [p.defaultSort, nameOf],
    ),
    sortKey: p.sortKey,
    onOpen,
    onToggle: toggleRow,
    estimate: ROW_HEIGHT[density],
    scrollRef,
    headerRef,
  });
  const { shown: rows, filter, setFilter, filterRef, allKeys, activeRow, sort } = list;
  const noun = p.label.toLowerCase();
  const hintId = useId();
  const understood = useMemo(() => parseQuery(filter, columnKeys).tokens, [filter, columnKeys]);

  // What the selection covers, said plainly in the bar: rows the filter hides
  // stay selected (and would be deleted), so the bar counts them.
  const shownKeys = useMemo(() => new Set(allKeys), [allKeys]);
  const hiddenSelected = useMemo(() => [...selectedKeys].filter((k) => !shownKeys.has(k)), [selectedKeys, shownKeys]);
  const allMatching = filter.trim() !== "" && hiddenSelected.length === 0 && rows.length > 1 && selectedKeys.size === rows.length;
  const selectionText = allMatching
    ? `All ${rows.length} ${noun} matching “${filter.trim()}” selected`
    : `${selectedKeys.size} selected`;

  // Escape clears the selection, unless a field, menu, drawer or dialog has it.
  const ctxOpen = ctx !== null;
  useEffect(() => {
    if (selectedKeys.size === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || ctxOpen) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(TYPING) || t?.closest?.(".drawer, .kb-modal")) return;
      clearAll();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedKeys.size, ctxOpen, clearAll]);

  // The confirmation takes focus on its safe choice.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirming = bulkDelete.pending !== null;
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);
  const { virtualizer, items: virtualRows, topSpace, bottomSpace } = list.virtual;

  async function confirmDelete() {
    const succeeded = await bulkDelete.confirm();
    deselect(succeeded.map((t) => `${t.ns}/${t.name}`));
  }

  return (
    <>
      <PageHeader
        level={2}
        title={p.title}
        count={p.titleCount}
        live={p.live}
        actions={
          <>
            <Badge title={rows.length === all.length ? undefined : "Shown of total"}>
              {countLabel(rows.length, all.length)}
            </Badge>
          </>
        }
      />

      {bulkDelete.pending && (
        <InlineBanner>
          <span>
            {bulkDelete.pending.length === 1 ? (
              <>
                Delete <strong className="mono">{bulkDelete.pending[0]!.name}</strong>
                {bulkDelete.pending[0]!.ns ? ` in ${bulkDelete.pending[0]!.ns}` : ""}? This can&apos;t be undone.
              </>
            ) : (
              <>
                Delete {bulkDelete.pending.length} selected {noun}? This can&apos;t be undone.
                <div className="small">{deletePreview(bulkDelete.pending)}</div>
              </>
            )}
            {(() => {
              const owner = ownerAmongTargets(bulkDelete.pending, [...p.objects]);
              return owner && <div className="small">{ownerWarning(owner)}</div>;
            })()}
          </span>
          <div className="inline-banner-actions">
            <Button ref={cancelRef} variant="ghost" disabled={bulkDelete.busy} onClick={bulkDelete.cancel}>
              Cancel
            </Button>
            <Button variant="danger" disabled={bulkDelete.busy} onClick={() => void confirmDelete()}>
              {bulkDelete.busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </InlineBanner>
      )}
      {bulkDelete.rejection && <PolicyRejectionCard flush={false} rejection={bulkDelete.rejection} />}
      {!bulkDelete.rejection && bulkDelete.error && <InlineBanner>{bulkDelete.error}</InlineBanner>}

      <div className="toolbar">
        {p.toolbar}
        <TextField
          ref={filterRef}
          placeholder={p.filterPlaceholder ?? `Filter ${noun}…  /`}
          aria-label={`Filter ${noun}`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
          aria-describedby={hintId}
          title={`key:value with ns, name, label${columnKeys.length ? ", " + columnKeys.join(", ") : ""}; a leading - excludes`}
        />
        <span id={hintId} hidden>
          {`Type words, or key:value with ns, name, label${columnKeys.length ? ", " + columnKeys.join(", ") : ""}. A leading - excludes.`}
        </span>
        {understood.length > 0 && (
          <span className="muted small">
            Filtering by {understood.map((t) => `${t.neg ? "not " : ""}${t.key}: ${t.value}`).join(" · ")}
          </span>
        )}
        <ColumnChooser
          columns={prefs.order.map((id) => ({ id, label: managed.find((m) => m.id === id)?.header ?? id, shown: visibleIds.has(id) }))}
          onToggle={prefs.toggle}
          onMove={prefs.move}
          onReset={prefs.reset}
        />
      </div>

      {shouldShowSkeleton(p.synced, all.length) ? (
        <SkeletonTable headers={headers} widths={widths} rows={10} leadingBlank label={`Loading ${noun}…`} />
      ) : rows.length === 0 ? (
        <EmptyState>
          <p>No {noun} match.</p>
          <p className="muted small">{filter || p.nsFiltered ? "Loosen the filters." : `Nothing in this ${p.scoped ? "cluster" : "namespace"} yet.`}</p>
        </EmptyState>
      ) : (
        <TableWrap ref={scrollRef} busy={p.busy}>
          <Table pinLead>
            <colgroup>
              <col style={{ width: 40 }} />
              {heads.map((h, i) => <col key={h.id} style={{ width: widths[i] }} />)}
              <col style={{ width: 36 }} /> {/* ⋮ column */}
            </colgroup>
            <thead ref={headerRef}>
              <tr>
                <SelectAllHeader
                  checked={isAllSelected(allKeys)}
                  indeterminate={isIndeterminate(allKeys)}
                  onChange={(checked) => (checked ? selectAll(allKeys) : clearAll())}
                />
                {heads.map((h, i) => (
                  <SortHeader
                    key={h.id}
                    label={h.header}
                    active={sort.col === h.id}
                    asc={sort.asc}
                    onSort={() => sort.toggle(h.id)}
                    width={widths[i]}
                    pinned={h.id === "Name"}
                    style={h.id === "Name" ? undefined : { position: "relative" }}
                  >
                    <div className="col-resize-handle" {...getResizeHandleProps(h.id)} />
                  </SortHeader>
                ))}
                <th className="col-row-menu" style={{ width: 36 }} /> {/* ⋮ header spacer */}
              </tr>
            </thead>
            <tbody>
              <VirtualSpacer height={topSpace} colSpan={headers.length + 2} />
              {virtualRows.map((virtualRow) => {
                const r = rows[virtualRow.index]!;
                const name = nameOf(r);
                const ns = nsOf(r);
                const key = allKeys[virtualRow.index]!;
                const isSelected = selectedKeys.has(key);
                const created = createdOf(r);
                return (
                  <TableRow
                    key={key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    clickable
                    selected={isSelected}
                    hovered={hoveredKey === key || activeRow === virtualRow.index}
                    aria-current={activeRow === virtualRow.index ? "true" : undefined}
                    dimmed={p.isDimmed?.(r) ?? false}
                    changed={changedKeys.has(key)}
                    onClick={() => onOpen(r)}
                    onMouseEnter={() => setHoveredKey(key)}
                    onMouseLeave={() => setHoveredKey(null)}
                    onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, row: r }); }}
                  >
                    <SelectCell checked={isSelected} onChange={() => toggleRow(key)} label={`Select ${name}`} />
                    <td className="mono td-name" title={name}><span>{name}</span></td>
                    {prefs.visible.map((id) => {
                      if (id === "Namespace")
                        return (
                          <td key={id} className="mono">
                            <NsPill
                              title={`Filter by namespace: ${ns}`}
                              onClick={() => {
                                if (p.cluster) setNamespaces(p.cluster, [ns]);
                              }}
                            >
                              {ns}
                            </NsPill>
                          </td>
                        );
                      if (id === "Age")
                        return (
                          <td key={id} className="mono muted" title={absoluteTime(created)}>
                            <LiveAge ts={created} />
                          </td>
                        );
                      const c = byCol.get(id);
                      if (!c) return null;
                      return (
                        <td
                          key={id}
                          className={(typeof c.className === "function" ? c.className(r) : c.className) ?? "mono muted"}
                          title={c.title?.(r)}
                        >
                          {c.cell(r)}
                        </td>
                      );
                    })}
                    {/* ⋮ kebab — visible only on row hover */}
                    <td className="col-row-menu" onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        label={`Actions for ${name}`}
                        className="row-menu-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCtx({ x: e.clientX, y: e.clientY, row: r });
                        }}
                      >
                        ⋮
                      </IconButton>
                    </td>
                  </TableRow>
                );
              })}
              <VirtualSpacer height={bottomSpace} colSpan={headers.length + 2} />
            </tbody>
          </Table>
        </TableWrap>
      )}

      {selectedKeys.size > 0 && (
        <SelectionBar
          actions={
            <>
              <Button variant="ghost" onClick={clearAll} title="Clear the selection (Esc)">
                Clear
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  bulkDelete.request(
                    [...selectedKeys].map((key) => {
                      const i = key.indexOf("/");
                      return { ns: key.slice(0, i), name: key.slice(i + 1) };
                    }),
                  );
                }}
              >
                Delete {selectedKeys.size} selected
              </Button>
            </>
          }
        >
          <span>{selectionText}</span>
          {hiddenSelected.length > 0 && (
            <>
              <span className="muted">· {hiddenSelected.length} hidden by filter</span>
              <Button variant="ghost" onClick={() => deselect(hiddenSelected)}>
                Deselect hidden
              </Button>
            </>
          )}
        </SelectionBar>
      )}
      <VisuallyHidden role="status">
        {selectedKeys.size > 0
          ? `Selection: ${selectionText}${hiddenSelected.length > 0 ? `, ${hiddenSelected.length} hidden by filter` : ""}`
          : ""}
      </VisuallyHidden>

      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
          items={p.menuItems(ctx.row, {
            requestDelete: () => bulkDelete.request([{ ns: nsOf(ctx.row), name: nameOf(ctx.row) }]),
          })}
        />
      )}
    </>
  );
}
