import { useEffect, useMemo, useRef, useState } from "react";
import { useResourceStream } from "../lib/useResourceStream";
import { useNamespaceStore, useSelectedNamespaces } from "../lib/namespace-store";

export function NamespaceFilter({ cluster }: { cluster: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selected = useSelectedNamespaces(cluster);
  const { setNamespaces, clearNamespaces } = useNamespaceStore();

  const namespaces = useResourceStream(cluster, "v1/namespaces", { mode: "metadata" });
  const all = useMemo(() => {
    return namespaces.rows
      .map((r) => {
        const meta = ((r ?? {}) as Record<string, unknown>).metadata as
          | Record<string, unknown>
          | undefined;
        return (meta?.name as string) ?? "";
      })
      .filter(Boolean)
      .sort();
  }, [namespaces.rows]);

  const filtered = useMemo(() => {
    if (!search) return all;
    return all.filter((n) => n.toLowerCase().includes(search.toLowerCase()));
  }, [all, search]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  function toggle(ns: string) {
    if (!cluster) return;
    if (selected.includes(ns)) {
      const next = selected.filter((n) => n !== ns);
      if (next.length === 0) clearNamespaces(cluster);
      else setNamespaces(cluster, next);
    } else {
      setNamespaces(cluster, [...selected, ns]);
    }
  }

  function selectAll() {
    if (cluster) clearNamespaces(cluster);
    setOpen(false);
    setSearch("");
  }

  const label =
    selected.length === 0
      ? "All namespaces"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} namespaces`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="ns-chip-trigger"
        onClick={() => setOpen((o) => !o)}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected.length === 0 ? (
          <span className="kb-fg-muted" style={{ color: "var(--kb-fg-muted)" }}>
            {label}
          </span>
        ) : selected.length === 1 ? (
          <span className="ns-chip">{label}</span>
        ) : (
          <span>{label}</span>
        )}
        <span className="ns-chevron" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="ns-dropdown" role="listbox" aria-multiselectable="true">
          <input
            className="toolbar-input"
            style={{
              width: "100%",
              borderRadius: 0,
              borderLeft: "none",
              borderRight: "none",
              borderTop: "none",
              borderBottom: "1px solid var(--kb-border-subtle)",
              height: 30,
            }}
            placeholder="Search namespaces…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            spellCheck={false}
            autoFocus
          />
          <div className="ns-dropdown-list">
            {/* "All namespaces" option — clears selection */}
            <button
              className={`ns-option${selected.length === 0 ? " selected" : ""}`}
              onClick={selectAll}
              type="button"
              role="option"
              aria-selected={selected.length === 0}
            >
              <span className={`ns-checkbox${selected.length === 0 ? " checked" : ""}`}>
                {selected.length === 0 ? "✓" : ""}
              </span>
              All namespaces
            </button>

            {filtered.map((ns) => {
              const isSelected = selected.includes(ns);
              return (
                <button
                  key={ns}
                  className={`ns-option${isSelected ? " selected" : ""}`}
                  onClick={() => toggle(ns)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                >
                  <span className={`ns-checkbox${isSelected ? " checked" : ""}`}>
                    {isSelected ? "✓" : ""}
                  </span>
                  {ns}
                </button>
              );
            })}

            {!filtered.length && (
              <div className="muted small" style={{ padding: "8px 12px" }}>
                No match.
              </div>
            )}
          </div>

          {selected.length > 0 && (
            <button className="ns-clear" onClick={selectAll} type="button">
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
