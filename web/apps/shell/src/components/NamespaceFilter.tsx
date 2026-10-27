import { useEffect, useMemo, useRef, useState } from "react";
import { useNamespaceStore, useSelectedNamespaces } from "../lib/namespace-store";
import { useClusterMeta } from "../lib/cluster-meta-store";
import { isNamespaceName, useNamespaceAccess } from "../lib/namespaceAccess";
import { IconButton, InlineBanner, Row, Stack, TextField } from "@kubebay/ui";
import { groupByProject, rancherProject } from "../lib/rancher";

const fieldStyle = {
  width: "100%",
  borderRadius: 0,
  borderLeft: "none",
  borderRight: "none",
  borderTop: "none",
  borderBottom: "1px solid var(--kb-border-subtle)",
  height: 30,
};

export function NamespaceFilter({ cluster }: { cluster: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState("");
  const [invalid, setInvalid] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selected = useSelectedNamespaces(cluster);
  const { setNamespaces, clearNamespaces } = useNamespaceStore();
  const { rememberNamespace, forgetNamespace } = useClusterMeta();

  // ADR 0003: an identity that can't list namespaces picks from the ones it
  // named, can't pick "All", and is told why.
  const access = useNamespaceAccess(cluster);
  const fallback = !!access.forbidden;

  // Each namespace with its Rancher project (KB-08), "" when it has none.
  const all = useMemo(() => {
    if (fallback) return [...new Set([...access.named, ...selected])].map((name) => ({ name, project: "" }));
    return access.rows
      .map((r) => {
        const meta = ((r ?? {}) as Record<string, unknown>).metadata as
          | { name?: string; annotations?: Record<string, string>; labels?: Record<string, string> }
          | undefined;
        return { name: meta?.name ?? "", project: rancherProject(meta) };
      })
      .filter((n) => n.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [fallback, access.named, access.rows, selected]);

  const filtered = useMemo(() => {
    if (!search) return all;
    return all.filter((n) => n.name.toLowerCase().includes(search.toLowerCase()));
  }, [all, search]);
  // Grouped only when the cluster has Rancher projects.
  const groups = useMemo(
    () => (all.some((n) => n.project) ? groupByProject(filtered) : [{ project: "", names: filtered.map((n) => n.name) }]),
    [all, filtered],
  );
  const grouped = groups.length > 1 || (groups[0]?.project ?? "") !== "";

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
      // With no namespaces listable, an empty selection would mean "all",
      // which this identity can't read.
      if (next.length === 0 && fallback) return;
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

  function add() {
    const name = adding.trim();
    if (!cluster || !name) return;
    if (!isNamespaceName(name)) {
      setInvalid(name);
      return;
    }
    rememberNamespace(cluster, name);
    if (!selected.includes(name)) setNamespaces(cluster, [...selected, name]);
    setAdding("");
    setInvalid("");
  }

  function forget(ns: string) {
    if (!cluster) return;
    forgetNamespace(cluster, ns);
    const next = selected.filter((n) => n !== ns);
    if (next.length !== selected.length) {
      if (next.length === 0) clearNamespaces(cluster);
      else setNamespaces(cluster, next);
    }
  }

  const label =
    selected.length === 0
      ? fallback
        ? "Name a namespace"
        : "All namespaces"
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
        <div className={`ns-dropdown${fallback ? " named" : ""}`} role="listbox" aria-multiselectable="true">
          {fallback ? (
            <>
              <InlineBanner tone="warn" flush>
                <Stack gap={1}>
                  <span>You can't list namespaces on this cluster. Showing the ones you named.</span>
                  <span className="muted small">{access.forbidden}</span>
                </Stack>
              </InlineBanner>
              <TextField
                style={fieldStyle}
                aria-label="Add a namespace"
                placeholder="Add a namespace…"
                value={adding}
                onChange={(e) => {
                  setAdding(e.target.value);
                  setInvalid("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
                spellCheck={false}
                autoFocus
              />
              {invalid && (
                <InlineBanner flush>
                  "{invalid}" isn't a namespace name: use lowercase letters, digits and "-".
                </InlineBanner>
              )}
            </>
          ) : (
            <TextField
              style={fieldStyle}
              placeholder="Search namespaces…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              spellCheck={false}
              autoFocus
            />
          )}
          <div className="ns-dropdown-list">
            {/* "All namespaces" option — clears selection */}
            {!fallback && (
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
            )}

            {groups.map((g) => {
              const options = g.names.map((ns) => {
                const isSelected = selected.includes(ns);
                const option = (
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
                // A typed namespace can be forgotten; the context's can't.
                if (!fallback || !access.remembered.includes(ns)) return option;
                return (
                  <Row key={ns} align="center">
                    {option}
                    <IconButton label={`Forget ${ns}`} onClick={() => forget(ns)}>
                      ×
                    </IconButton>
                  </Row>
                );
              });
              if (!grouped) return options;
              const label = g.project ? `Project ${g.project}` : "Not in a project";
              return (
                <div key={g.project || "-"} role="group" aria-label={label}>
                  <div className="muted small strong" style={{ padding: "6px 12px 2px" }} aria-hidden>
                    {label}
                  </div>
                  {options}
                </div>
              );
            })}

            {!filtered.length && (
              <div className="muted small" style={{ padding: "8px 12px" }}>
                {fallback ? "Add a namespace you can read." : "No match."}
              </div>
            )}
          </div>

          {selected.length > 0 && !fallback && (
            <button className="ns-clear" onClick={selectAll} type="button">
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
