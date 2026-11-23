import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, DataTable, EmptyState, InlineBanner, PageHeader, Stack, TextField } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { api } from "../lib/api";
import { getConnectedClusters, subscribeConnections } from "../lib/clusterConnections";
import { useClusterMeta } from "../lib/cluster-meta-store";
import { MAX_RESULTS, coldNotes, coldTargets, crossClusterRows, type CrossClusterRow } from "../lib/crossClusterSearch";
import { openObjectInCluster } from "../lib/openCluster";
import { buildIndex, mergeGroups, parseQuery, search } from "../lib/paletteSearch";
import { useColdSearch } from "../lib/useColdSearch";
import { usePaletteObjects } from "../lib/usePaletteObjects";
import { usePaletteRemote } from "../lib/usePaletteRemote";

// The engine's index answers at most 50 hits per kind and 20 kinds per cluster.
const REMOTE_LIMITS = { perGroup: 50, maxGroups: 20 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The clusters with streams open, kept current as clusters connect and disconnect. */
function useConnected(): string[] {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeConnections(() => setTick((t) => t + 1)), []);
  const key = [...getConnectedClusters()].sort().join("\0");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (key ? key.split("\0") : []), [key, tick]);
}

/**
 * Search all clusters: finds objects by name, or kind and name, in every
 * cluster. Connected clusters are searched from what the app holds and the
 * engine's index; the others only when asked, and without connecting them.
 */
export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const setQ = (v: string) => setParams(v ? { q: v } : {}, { replace: true });
  const [withCold, setWithCold] = useState(false);
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const meta = useClusterMeta((s) => s.meta);
  const nameOf = (id: string) => meta[id]?.alias || id;
  const clusterList = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, staleTime: 30_000 });

  const connected = useConnected();
  const parsed = parseQuery(q);
  const listing = parsed.terms.length === 0;
  const objects = usePaletteObjects(true, connected);
  const index = useMemo(() => buildIndex(objects), [objects]);
  const local = useMemo(() => (q.trim() ? search(index, q, { perGroup: MAX_RESULTS, maxGroups: 50 }) : []), [index, q]);
  const remote = usePaletteRemote(true, connected, q, REMOTE_LIMITS);
  const warm = useMemo(() => {
    // A query naming a kind the engine knows is about that kind alone.
    const mine = remote.filter ? local.filter((g) => g.slug === remote.filter) : local;
    return mergeGroups(mine, remote.groups, { listing, perGroup: MAX_RESULTS, maxGroups: 50 });
  }, [local, remote.groups, remote.filter, listing]);

  const coldIds = useMemo(
    () => coldTargets(clusterList.data ?? [], new Set(connected), meta),
    [clusterList.data, connected, meta],
  );
  const coldSearch = useColdSearch(withCold, coldIds, q);
  const coldData = withCold ? coldSearch.data : undefined;
  const { rows, total, capped } = useMemo(
    () => crossClusterRows(warm, coldData?.hits ?? [], { listing, coldTotal: coldData?.total }),
    [warm, coldData, listing],
  );
  const notes = coldData ? coldNotes(coldData, nameOf) : [];
  const searching = remote.loading || (withCold && coldSearch.loading);
  const hasQuery = q.trim() !== "";

  const open = (r: CrossClusterRow) => openObjectInCluster(r, queryClient, nav);

  return (
    <div className="page">
      <PageHeader help={<PageHelp route="/search" />} level={2} title="Search all clusters" count={hasQuery ? total : undefined} />

      <div className="toolbar">
        <TextField
          aria-label="Search all clusters"
          placeholder="A name, or a kind and a name: deploy api, svc:web, pod checkout"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      </div>

      {hasQuery && coldIds.length > 0 && !withCold && (
        <InlineBanner
          tone="warn"
          actions={<Button onClick={() => setWithCold(true)}>{`Also search ${plural(coldIds.length, "disconnected cluster")}`}</Button>}
        >
          {`${plural(coldIds.length, "cluster")} that aren't connected weren't searched.`}
        </InlineBanner>
      )}
      {hasQuery && withCold && coldIds.length > 0 && (
        <InlineBanner tone="ok" actions={<Button onClick={() => setWithCold(false)}>Connected clusters only</Button>}>
          {`Also searching ${plural(coldIds.length, "disconnected cluster")}, without connecting them.`}
        </InlineBanner>
      )}
      {remote.error && <InlineBanner>{`Couldn't search the connected clusters' other kinds. ${remote.error}`}</InlineBanner>}
      {withCold && coldSearch.error && <InlineBanner>{`Couldn't search the disconnected clusters. ${coldSearch.error}`}</InlineBanner>}
      {remote.denied.map((d) => (
        <InlineBanner key={`warm:${d.label}`} tone="warn">{`Your access can't list ${d.label} in a connected cluster. ${d.reason}`}</InlineBanner>
      ))}
      {notes
        .filter((n) => n.tone !== "info")
        .map((n) => (
          <InlineBanner key={n.key} tone={n.tone === "warn" ? "warn" : "err"}>
            {n.text}
          </InlineBanner>
        ))}

      {(capped || notes.some((n) => n.tone === "info")) && (
        <Stack gap={1}>
          {capped && <span className="muted small">{`Showing the first ${rows.length} of ${total}. Add words to narrow it down.`}</span>}
          {notes
            .filter((n) => n.tone === "info")
            .map((n) => (
              <span key={n.key} className="muted small">
                {n.text}
              </span>
            ))}
        </Stack>
      )}

      {!hasQuery ? (
        <EmptyState
          title="Search every cluster at once."
          hint="Type a name, or a kind and a name (deploy api). Connected clusters are searched as you type; the others only if you ask."
        />
      ) : (
        <DataTable
          loading={searching && rows.length === 0}
          loadingLabel="Searching clusters…"
          rows={rows}
          rowKey={(r) => `${r.cluster}\0${r.slug}\0${r.ns}\0${r.name}`}
          onRowClick={open}
          empty={<EmptyState title={`Nothing matches “${q.trim()}”.`} hint="Check the spelling, or name the kind: deploy api, svc web." />}
          columns={[
            { key: "cluster", header: "Cluster", width: 180, className: "mono small", title: (r) => r.cluster, render: (r) => nameOf(r.cluster) },
            { key: "kind", header: "Kind", width: 150, className: "small", render: (r) => r.kind },
            { key: "ns", header: "Namespace", width: 180, className: "mono muted small", render: (r) => r.ns || "–" },
            { key: "name", header: "Name", className: "mono td-name", title: (r) => r.name, render: (r) => r.name },
          ]}
        />
      )}
    </div>
  );
}
