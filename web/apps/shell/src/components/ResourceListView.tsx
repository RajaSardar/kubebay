import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge, Button, EmptyState, IconButton, InlineBanner, NsPill, PageHeader, SelectAllHeader, SelectCell, SkeletonTable, SortHeader, Table, TableRow, TableWrap, TextField } from "@kubebay/ui";
import { shouldShowSkeleton } from "../lib/useResourceStream";
import { useResizableColumns } from "../lib/useResizableColumns";
import { useRowSelection } from "../lib/useRowSelection";
import { useBulkDelete, type DeleteTarget } from "../lib/useBulkDelete";
import { useResourceList } from "../lib/useResourceList";
import { ROW_HEIGHT, useDisplay } from "../lib/display";
import { ownerAmongTargets, ownerLabel, ownerWarning } from "../lib/gitops";
import { absoluteTime, compareValues, countLabel } from "../lib/tableUx";
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
  columns: readonly ListColumn<R>[];
  /** Where the chosen sort is remembered ("r/deployments"). */
  sortKey: string;
  /** Order when no column is sorted (by name when unset). */
  defaultSort?: (a: R, b: R) => number;
  /** The filter's placeholder ("Filter <label>…  /" when unset). */
  filterPlaceholder?: string;
  onOpen: (r: R) => void;
  /** The row menu; Delete goes through `requestDelete` to get the confirmation. */
  menuItems: (r: R, actions: { requestDelete: () => void }) => MenuItem[];
  onDelete: (t: DeleteTarget, gitopsOwner?: string) => Promise<unknown>;
  /** Controls placed before the filter field (namespace filter). */
  toolbar?: ReactNode;
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

  const headers = useMemo(
    () => ["Name", ...(p.scoped ? [] : ["Namespace"]), ...columns.map((c) => c.header), "Age"],
    [p.scoped, columns],
  );
  const initialWidths = useMemo(
    () => [NAME_W, ...(p.scoped ? [] : [NS_W]), ...columns.map((c) => c.width ?? COL_W), AGE_W],
    [p.scoped, columns],
  );
  const { widths, getResizeHandleProps } = useResizableColumns(headers.length, initialWidths);
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
  const byCol = useMemo(() => new Map(columns.map((c) => [c.header, c])), [columns]);
  const createdOf = p.createdOf;

  const list = useResourceList<R>({
    rows: all,
    keyOf,
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
  const { virtualizer, items: virtualRows, topSpace, bottomSpace } = list.virtual;
  const noun = p.label.toLowerCase();

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
            {selectedKeys.size > 0 && (
              <>
                <span className="muted small">{selectedKeys.size} selected</span>
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
            )}
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
              </>
            )}
            {(() => {
              const owner = ownerAmongTargets(bulkDelete.pending, [...p.objects]);
              return owner && <div className="small">{ownerWarning(owner)}</div>;
            })()}
          </span>
          <div className="inline-banner-actions">
            <Button variant="ghost" disabled={bulkDelete.busy} onClick={bulkDelete.cancel}>
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
          <Table>
            <colgroup>
              <col style={{ width: 40 }} />
              {headers.map((h, i) => <col key={h} style={{ width: widths[i] }} />)}
              <col style={{ width: 36 }} /> {/* ⋮ column */}
            </colgroup>
            <thead ref={headerRef}>
              <tr>
                <SelectAllHeader
                  checked={isAllSelected(allKeys)}
                  indeterminate={isIndeterminate(allKeys)}
                  onChange={(checked) => (checked ? selectAll(allKeys) : clearAll())}
                />
                {headers.map((h, i) => (
                  <SortHeader
                    key={h}
                    label={h}
                    active={sort.col === h}
                    asc={sort.asc}
                    onSort={() => sort.toggle(h)}
                    width={widths[i]}
                    style={{ position: "relative" }}
                  >
                    <div className="col-resize-handle" {...getResizeHandleProps(i)} />
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
                    onClick={() => onOpen(r)}
                    onMouseEnter={() => setHoveredKey(key)}
                    onMouseLeave={() => setHoveredKey(null)}
                    onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, row: r }); }}
                  >
                    <SelectCell checked={isSelected} onChange={() => toggleRow(key)} label={`Select ${name}`} />
                    <td className="mono td-name" title={name}>{name}</td>
                    {!p.scoped && (
                      <td className="mono">
                        <NsPill
                          title={`Filter by namespace: ${ns}`}
                          onClick={() => {
                            if (p.cluster) setNamespaces(p.cluster, [ns]);
                          }}
                        >
                          {ns}
                        </NsPill>
                      </td>
                    )}
                    {columns.map((c) => (
                      <td
                        key={c.id}
                        className={(typeof c.className === "function" ? c.className(r) : c.className) ?? "mono muted"}
                        title={c.title?.(r)}
                      >
                        {c.cell(r)}
                      </td>
                    ))}
                    <td className="mono muted" title={absoluteTime(created)}><LiveAge ts={created} /></td>
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
