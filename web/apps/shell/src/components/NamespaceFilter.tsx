import { useEffect, useMemo, useRef, useState } from "react";
import { useResourceStream } from "../lib/useResourceStream";

export function NamespaceFilter({
  cluster,
  selected,
  onChange,
}: {
  cluster: string | undefined;
  selected: string[];
  onChange: (ns: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const namespaces = useResourceStream(cluster, "v1/namespaces", { mode: "metadata" });
  const all = useMemo(() => {
    const names = namespaces.rows
      .map((r) => {
        const meta = ((r ?? {}) as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
        return (meta?.name as string) ?? "";
      })
      .filter(Boolean)
      .sort();
    return names;
  }, [namespaces.rows]);

  const filtered = useMemo(() => {
    if (!search) return all;
    return all.filter((n) => n.toLowerCase().includes(search.toLowerCase()));
  }, [all, search]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function toggle(ns: string) {
    if (selected.includes(ns)) onChange(selected.filter((n) => n !== ns));
    else onChange([...selected, ns]);
  }

  function clear() {
    onChange([]);
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        className="ns-chip-trigger"
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
      >
        {selected.length === 0 ? (
          <span className="muted">All namespaces</span>
        ) : selected.length <= 2 ? (
          <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {selected.map((ns) => (
              <span key={ns} className="ns-chip">
                {ns}
                <button
                  className="ns-chip-x"
                  onClick={(e) => { e.stopPropagation(); toggle(ns); }}
                >
                  ×
                </button>
              </span>
            ))}
          </span>
        ) : (
          <span>{selected.length} namespaces</span>
        )}
        <span className="ns-chevron">▾</span>
      </div>

      {open && (
        <div className="ns-dropdown">
          <input
            className="toolbar-input"
            style={{ width: "100%", borderRadius: 0, borderBottom: "1px solid var(--kb-border-subtle)" }}
            placeholder="Search namespaces…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            spellCheck={false}
            autoFocus
          />
          <div className="ns-dropdown-list">
            {filtered.map((ns) => (
              <button
                key={ns}
                className={`ns-option${selected.includes(ns) ? " selected" : ""}`}
                onClick={() => toggle(ns)}
              >
                <span className={`ns-checkbox${selected.includes(ns) ? " checked" : ""}`}>
                  {selected.includes(ns) ? "✓" : ""}
                </span>
                {ns}
              </button>
            ))}
            {!filtered.length && <div className="muted small" style={{ padding: "8px 12px" }}>No match.</div>}
          </div>
          {selected.length > 0 && (
            <button className="ns-clear" onClick={clear}>
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
