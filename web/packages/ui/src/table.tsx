import {
  forwardRef,
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type TableHTMLAttributes,
} from "react";
import { Skeleton } from "./index";

// ── Feedback ──────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** One sentence saying what is missing: "No pods match." */
  title?: ReactNode;
  /** What to do about it, in muted small text: "Loosen the filters." */
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** The dashed "nothing here" slot shown instead of an empty table or list. */
export function EmptyState({ title, hint, children, className, style }: EmptyStateProps) {
  return (
    <div className={`empty-state${className ? " " + className : ""}`} style={style}>
      {title != null && <p>{title}</p>}
      {hint != null && <p className="muted small">{hint}</p>}
      {children}
    </div>
  );
}

export interface InlineBannerProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  /** Error by default; ok and warn restate it in the other status colours. */
  tone?: "err" | "ok" | "warn";
  /** Right-hand buttons, e.g. Cancel / Delete. */
  actions?: ReactNode;
  /** No page gutter: for banners inside a drawer, form or card. */
  flush?: boolean;
  className?: string;
}

/** A status box between the page header and the content: errors, confirmations, notices. */
export function InlineBanner({ tone = "err", actions, flush, className, children, ...props }: InlineBannerProps) {
  const cls = `inline-banner${tone === "err" ? "" : " " + tone}${flush ? " flush" : ""}${className ? " " + className : ""}`;
  return (
    <div className={cls} {...props}>
      {children}
      {actions != null && actions !== false && <span className="inline-banner-actions">{actions}</span>}
    </div>
  );
}

// ── Table primitives (the ResourceTable design) ───────────────────────────────

/** Scroll container for a table: fills the page body on `kb-bg-surface`. */
export interface TableWrapProps extends HTMLAttributes<HTMLDivElement> {
  /** Rows on screen are being refreshed (a stream re-syncing): a thin progress bar runs along the top. */
  busy?: boolean;
}

export const TableWrap = forwardRef<HTMLDivElement, TableWrapProps>(function TableWrap(
  { className, busy, children, ...props },
  ref,
) {
  return (
    <div ref={ref} className={`table-wrap${className ? " " + className : ""}`} aria-busy={busy || undefined} {...props}>
      {busy && <div className="kb-table-progress" aria-hidden="true" />}
      {children}
    </div>
  );
});

/**
 * `table.kb-table`: sticky blurred header, hairline rows, ellipsized fixed-layout cells.
 * `pinLead` keeps the select column and the Name column (`td.td-name`, a `SortHeader pinned`)
 * in place while a wide table scrolls sideways.
 */
export function Table({ className, pinLead, ...props }: TableHTMLAttributes<HTMLTableElement> & { pinLead?: boolean }) {
  return <table className={`kb-table${pinLead ? " kb-table-pin-lead" : ""}${className ? " " + className : ""}`} {...props} />;
}

export interface SortHeaderProps {
  label: string;
  /** This column is the current sort. */
  active?: boolean;
  asc?: boolean;
  onSort?: (label: string) => void;
  width?: number | string;
  /** Extra content inside the header cell, e.g. a column-resize handle. */
  children?: ReactNode;
  style?: CSSProperties;
  /** The Name header of a `Table pinLead`: stays in place on horizontal scroll. */
  pinned?: boolean;
}

/** A column header with the accent sort arrow; sorts on click, or Enter/Space when focused. */
export function SortHeader({ label, active, asc, onSort, width, children, style, pinned }: SortHeaderProps) {
  return (
    <th
      className={pinned ? "th-sortable th-pin" : "th-sortable"}
      style={{ width, ...style }}
      aria-sort={active ? (asc ? "ascending" : "descending") : "none"}
      tabIndex={0}
      onClick={() => onSort?.(label)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        // Handled: a table's own Enter (open the active row) stands down.
        e.preventDefault();
        onSort?.(label);
      }}
    >
      {label}
      {active && <span className="sort-indicator">{asc ? "↑" : "↓"}</span>}
      {children}
    </th>
  );
}

function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="kb-checkbox"
      checked={checked}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/** The select-all checkbox header cell, on the page gutter. */
export function SelectAllHeader(props: { checked: boolean; indeterminate?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <th className="col-select" style={{ width: 40 }}>
      <Checkbox {...props} label="Select all" />
    </th>
  );
}

/** A row's selection checkbox; clicks on it never reach the row. */
export function SelectCell({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <td className="col-select" onClick={(e) => e.stopPropagation()}>
      <Checkbox checked={checked} onChange={onChange} label={label} />
    </td>
  );
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
  /** Keyboard/menu hover that should reveal the row menu. */
  hovered?: boolean;
  /** Terminating or otherwise on its way out: drawn at half opacity. */
  dimmed?: boolean;
  /** Opens something when clicked. */
  clickable?: boolean;
}

export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow(
  { selected, hovered, dimmed, clickable, className, ...props },
  ref,
) {
  const cls = [clickable && "row-clickable", selected && "selected", hovered && "hovered", className].filter(Boolean).join(" ");
  return <tr ref={ref} className={cls || undefined} data-terminating={dimmed || undefined} {...props} />;
});

/** The clickable namespace chip in a table cell. */
export function NsPill({ children, onClick, title }: { children: ReactNode; onClick?: () => void; title?: string }) {
  return (
    <span
      className="cell-link ns-pill"
      title={title}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

const SKELETON_WIDTHS = [150, 90, 60, 70, 60, 50];
// Rows differ in length, as real names and values do, so the sketch reads as data.
const ROW_FACTORS = [1, 0.72, 0.86, 0.64, 0.93, 0.78];

function skeletonWidth(row: number, col: number) {
  return Math.round(SKELETON_WIDTHS[col % SKELETON_WIDTHS.length]! * ROW_FACTORS[(row + col) % ROW_FACTORS.length]!);
}

/** Placeholder rows while a table's data streams in. */
export function SkeletonRows({ columns, rows = 5, leadingBlank }: { columns: number; rows?: number; leadingBlank?: boolean }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i}>
          {leadingBlank && <td />}
          {Array.from({ length: columns }, (_, j) => (
            <td key={j}>
              <Skeleton w={skeletonWidth(i, j)} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export interface SkeletonTableProps {
  /** The real column headers, so the page keeps its shape when the data lands. */
  headers: readonly string[];
  rows?: number;
  /** A blank first column for the select checkbox. */
  leadingBlank?: boolean;
  /** Column widths, in step with the real table's. */
  widths?: readonly (number | string | undefined)[];
  /** What is loading, for screen readers. */
  label?: string;
}

/** A whole table's placeholder: its header over skeleton rows. Use it for every list that is still loading. */
export function SkeletonTable({ headers, rows = 8, leadingBlank, widths, label = "Loading…" }: SkeletonTableProps) {
  return (
    <TableWrap role="status" aria-label={label} aria-busy="true">
      <Table>
        <thead>
          <tr>
            {leadingBlank && <th style={{ width: 40 }} />}
            {headers.map((h, i) => (
              <th key={h} style={{ width: widths?.[i] }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <SkeletonRows columns={headers.length} rows={rows} leadingBlank={leadingBlank} />
        </tbody>
      </Table>
    </TableWrap>
  );
}

/** Placeholder lines for a paragraph or a key/value list (a drawer's summary, a YAML pane). */
export function SkeletonLines({ lines = 4, label = "Loading…" }: { lines?: number; label?: string }) {
  return (
    <div className="kb-skeleton-lines" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} w={`${[92, 76, 84, 58, 70, 64][i % 6]}%`} />
      ))}
    </div>
  );
}

// ── DataTable ─────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  width?: number | string;
  /** Cell class, e.g. "mono td-name" for the name column, "cell-secondary" for facts. */
  className?: string;
  /** Tooltip for truncated cells. */
  title?: (row: T) => string | undefined;
  sortable?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  sort?: { key: string; asc: boolean };
  onSort?: (key: string) => void;
  selection?: {
    selected: ReadonlySet<string>;
    onToggle: (key: string) => void;
    onToggleAll: (checked: boolean) => void;
    /** Accessible name for a row checkbox; default "Select <key>". */
    label?: (row: T) => string;
  };
  onRowClick?: (row: T) => void;
  /** Rows drawn dimmed, e.g. Terminating objects. */
  isDimmed?: (row: T) => boolean;
  /** Shown instead of the table when there are no rows (and not loading). */
  empty?: ReactNode;
  /** Show skeleton rows instead of data. */
  loading?: boolean;
  /** Wrap in TableWrap (default). Set false inside a Card or drawer that scrolls itself. */
  wrap?: boolean;
  style?: CSSProperties;
}

/** The ResourceTable design as one component: use it for every table in the app. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  selection,
  onRowClick,
  isDimmed,
  empty,
  loading,
  wrap = true,
  style,
}: DataTableProps<T>) {
  if (!loading && rows.length === 0 && empty != null) return <>{empty}</>;
  const keys = rows.map((r, i) => rowKey(r, i));
  const selectedCount = selection ? keys.filter((k) => selection.selected.has(k)).length : 0;
  const table = (
    <Table style={style}>
      <thead>
        <tr>
          {selection && (
            <SelectAllHeader
              checked={keys.length > 0 && selectedCount === keys.length}
              indeterminate={selectedCount > 0 && selectedCount < keys.length}
              onChange={selection.onToggleAll}
            />
          )}
          {columns.map((c) =>
            c.sortable && onSort ? (
              <SortHeader
                key={c.key}
                label={typeof c.header === "string" ? c.header : c.key}
                active={sort?.key === c.key}
                asc={sort?.asc}
                onSort={() => onSort(c.key)}
                width={c.width}
              />
            ) : (
              <th key={c.key} style={{ width: c.width }}>
                {c.header}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <SkeletonRows columns={columns.length} leadingBlank={!!selection} />
        ) : (
          rows.map((row, i) => {
            const key = keys[i]!;
            return (
              <TableRow
                key={key}
                selected={selection?.selected.has(key)}
                dimmed={isDimmed?.(row)}
                clickable={!!onRowClick}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {selection && (
                  <SelectCell
                    checked={selection.selected.has(key)}
                    onChange={() => selection.onToggle(key)}
                    label={selection.label?.(row) ?? `Select ${key}`}
                  />
                )}
                {columns.map((c) => (
                  <td key={c.key} className={c.className} title={c.title?.(row)}>
                    {c.render(row, i)}
                  </td>
                ))}
              </TableRow>
            );
          })
        )}
      </tbody>
    </Table>
  );
  return wrap ? <TableWrap>{table}</TableWrap> : table;
}
