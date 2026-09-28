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
  className?: string;
}

/** A status box between the page header and the content: errors, confirmations, notices. */
export function InlineBanner({ tone = "err", actions, className, children, ...props }: InlineBannerProps) {
  const cls = `inline-banner${tone === "err" ? "" : " " + tone}${className ? " " + className : ""}`;
  return (
    <div className={cls} {...props}>
      {children}
      {actions != null && actions !== false && <span className="inline-banner-actions">{actions}</span>}
    </div>
  );
}

// ── Table primitives (the ResourceTable design) ───────────────────────────────

/** Scroll container for a table: fills the page body on `kb-bg-surface`. */
export const TableWrap = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function TableWrap(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={`table-wrap${className ? " " + className : ""}`} {...props} />;
});

/** `table.kb-table`: sticky blurred header, hairline rows, ellipsized fixed-layout cells. */
export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={`kb-table${className ? " " + className : ""}`} {...props} />;
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
}

/** A clickable column header with the accent sort arrow. */
export function SortHeader({ label, active, asc, onSort, width, children, style }: SortHeaderProps) {
  return (
    <th
      className="th-sortable"
      style={{ width, ...style }}
      aria-sort={active ? (asc ? "ascending" : "descending") : "none"}
      onClick={() => onSort?.(label)}
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
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </span>
  );
}

const SKELETON_WIDTHS = [150, 90, 60, 70, 60, 50];

/** Placeholder rows while a table's data streams in. */
export function SkeletonRows({ columns, rows = 5, leadingBlank }: { columns: number; rows?: number; leadingBlank?: boolean }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i}>
          {leadingBlank && <td />}
          {Array.from({ length: columns }, (_, j) => (
            <td key={j}>
              <Skeleton w={SKELETON_WIDTHS[j % SKELETON_WIDTHS.length]} />
            </td>
          ))}
        </tr>
      ))}
    </>
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
