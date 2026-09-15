import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { crdApi, type CRDEntry } from "../lib/api";
import { extSlug } from "../lib/resources";
import { useCluster } from "../lib/useCluster";

function extPath(r: CRDEntry) {
  return `/r/ext--${extSlug(r.gvr)}?scoped=${r.namespaced ? 0 : 1}`;
}

export default function Crds() {
  const { cluster } = useCluster();
  const q = useQuery({
    queryKey: ["crds", cluster],
    queryFn: () => crdApi.list(cluster),
    enabled: !!cluster,
    staleTime: 30_000,
    retry: 2,
  });

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleGroup(g: string) {
    setCollapsed((s) => {
      const next = new Set(s);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  }

  const groups = useMemo(() => {
    const map = new Map<string, CRDEntry[]>();
    for (const e of q.data ?? []) {
      if (!map.has(e.group)) map.set(e.group, []);
      map.get(e.group)!.push(e);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [q.data]);

  const filtered = useMemo(() => {
    const lc = search.toLowerCase();
    if (!lc) return groups;
    return groups
      .map(([g, rows]) => [g, rows.filter(
        (r) => r.kind.toLowerCase().includes(lc) || r.resource.toLowerCase().includes(lc) || r.group.toLowerCase().includes(lc),
      )] as [string, CRDEntry[]])
      .filter(([, rows]) => rows.length > 0);
  }, [groups, search]);

  const totalCount = (q.data ?? []).length;

  if (!cluster) {
    return (
      <div className="page">
        <h1>Custom Resource Definitions</h1>
        <p className="muted small">Connect to a cluster to browse CRDs.</p>
      </div>
    );
  }

  return (
    <div className="page" style={{ overflowY: "auto" }}>
      <div className="page-header">
        <h1 style={{ margin: 0 }}>Custom Resource Definitions</h1>
        <span className="muted small">{q.isLoading ? "Loading…" : `${totalCount} CRDs`}</span>
      </div>

      {q.isError && (
        <div className="crd-error">
          <span>Failed to load CRDs: {String(q.error)}</span>
          <button className="btn-ghost small" onClick={() => q.refetch()}>Retry</button>
        </div>
      )}

      <div className="toolbar" style={{ gap: 8, marginBottom: 12 }}>
        <input
          className="toolbar-input"
          placeholder="Search kinds…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          style={{ maxWidth: 280 }}
        />
        {q.isLoading && <span className="crd-loading-dots"><span /><span /><span /></span>}
        {!q.isLoading && search && (
          <span className="muted small">
            {filtered.reduce((s, [, r]) => s + r.length, 0)} of {totalCount} matching
          </span>
        )}
      </div>

      {filtered.length === 0 && !q.isLoading && !q.isError && (
        <p className="muted small">
          {search ? "No CRDs match your search." : "No custom resources found on this cluster."}
        </p>
      )}

      <div className="crd-tree">
        {filtered.map(([group, rows]) => {
          const open = !collapsed.has(group);
          return (
            <div key={group} className="crd-tree-group">
              <button
                className="crd-tree-group-header"
                onClick={() => toggleGroup(group)}
                aria-expanded={open}
              >
                <span className="crd-tree-chevron">{open ? "▾" : "▸"}</span>
                <span className="crd-tree-group-name">{group}</span>
                <span className="crd-tree-count">{rows.length}</span>
              </button>

              {open && (
                <div className="crd-tree-rows">
                  {rows.map((r) => (
                    <NavLink
                      key={r.gvr}
                      to={extPath(r)}
                      className={({ isActive }) => `crd-tree-row${isActive ? " active" : ""}`}
                    >
                      <span className="crd-tree-kind">{r.kind}</span>
                      <span className="crd-tree-meta">
                        <span className="mono muted" style={{ fontSize: 11 }}>{r.version}</span>
                        <span className={`crd-badge ${r.namespaced ? "ns" : "cluster"}`}>
                          {r.namespaced ? "ns" : "cluster"}
                        </span>
                        {r.columns.length > 0 && (
                          <span className="crd-badge cols" title={r.columns.map((c) => c.name).join(", ")}>
                            {r.columns.length} cols
                          </span>
                        )}
                      </span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
