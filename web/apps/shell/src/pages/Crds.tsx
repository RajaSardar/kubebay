import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { api, discoveryApi, type APIResourceEntry } from "../lib/api";
import { extSlug, KNOWN_GVRS } from "../lib/resources";

export default function Crds() {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const cluster = (clusters.data ?? []).find((c) => c.status === "connected")?.id ?? "";
  const allApis = useQuery({
    queryKey: ["apis", cluster],
    queryFn: () => discoveryApi.apis(cluster),
    enabled: !!cluster,
    staleTime: 60_000,
  });

  const [groupFilter, setGroupFilter] = useState("");
  const [search, setSearch] = useState("");

  const groups = useMemo(() => {
    const map = new Map<string, APIResourceEntry[]>();
    for (const e of allApis.data ?? []) {
      if (KNOWN_GVRS.has(e.gvr)) continue;
      const g = e.group || "(core)";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(e);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, resources]) => ({
        group,
        resources: resources.sort((a, b) => a.kind.localeCompare(b.kind)),
      }));
  }, [allApis.data]);

  const filtered = useMemo(() => {
    return groups
      .filter((g) => !groupFilter || g.group === groupFilter)
      .map((g) => ({
        ...g,
        resources: g.resources.filter(
          (r) =>
            !search ||
            r.kind.toLowerCase().includes(search.toLowerCase()) ||
            r.resource.toLowerCase().includes(search.toLowerCase()) ||
            r.group.toLowerCase().includes(search.toLowerCase()),
        ),
      }))
      .filter((g) => g.resources.length > 0);
  }, [groups, groupFilter, search]);

  const allGroupNames = useMemo(() => groups.map((g) => g.group), [groups]);
  const totalCount = groups.reduce((s, g) => s + g.resources.length, 0);

  if (!cluster) {
    return (
      <div className="page">
        <h1>Custom Resource Definitions</h1>
        <p className="muted small">Connect to a cluster to browse CRDs.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Custom Resource Definitions</h1>

      <div className="toolbar" style={{ gap: 8 }}>
        <input
          className="toolbar-input"
          placeholder="Search kinds…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          style={{ maxWidth: 220 }}
        />
        <select
          className="toolbar-input"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          style={{ maxWidth: 220 }}
        >
          <option value="">All groups ({totalCount})</option>
          {allGroupNames.map((g) => (
            <option key={g} value={g}>
              {g} ({groups.find((gr) => gr.group === g)?.resources.length ?? 0})
            </option>
          ))}
        </select>
        {allApis.isLoading && <span className="muted small">Loading…</span>}
      </div>

      {filtered.map((g) => (
        <div key={g.group} className="crd-group">
          <div className="crd-group-header">
            <span className="crd-group-name">{g.group}</span>
            <span className="muted small">{g.resources.length} kind{g.resources.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="crd-grid">
            {g.resources.map((r) => (
              <NavLink
                key={r.gvr}
                to={`/r/ext--${extSlug(r.gvr)}?scoped=${r.namespaced ? 0 : 1}`}
                className="crd-card"
              >
                <span className="crd-card-kind">{r.kind}</span>
                <span className="crd-card-meta">
                  <span className="mono">{r.gvr}</span>
                  {r.namespaced && <span className="crd-badge ns">namespaced</span>}
                  {!r.namespaced && <span className="crd-badge cluster">cluster</span>}
                </span>
              </NavLink>
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && !allApis.isLoading && (
        <p className="muted small">
          {search || groupFilter ? "No CRDs match your filters." : "No custom resources found on this cluster."}
        </p>
      )}
    </div>
  );
}
