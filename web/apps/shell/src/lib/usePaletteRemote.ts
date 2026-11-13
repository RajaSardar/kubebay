import { useEffect, useState } from "react";
import { searchApi, type SearchResponse } from "./api";
import { mergeGroups, parseQuery, type SearchGroup } from "./paletteSearch";

export interface RemoteState {
  groups: SearchGroup[];
  /** The kind the query named, which the engine answers for. */
  filter: string;
  /** Kinds still listing: the groups may be incomplete. */
  pending: string[];
  onDemand: string[];
  truncated: string[];
  denied: { label: string; reason: string }[];
  loading: boolean;
  error: string;
}

const EMPTY: RemoteState = { groups: [], filter: "", pending: [], onDemand: [], truncated: [], denied: [], loading: false, error: "" };

// The kinds the palette searches from memory; asking the engine would repeat that.
const LOCAL = new Set(["pods", "deployments", "statefulsets", "daemonsets", "jobs", "nodes", "namespaces"]);

const DEBOUNCE_MS = 120;
// While the engine is still listing kinds it has just started following, ask
// again so the results fill in; give up after about twenty seconds.
const POLL_MS = 1200;
const MAX_POLLS = 12;

const union = <T,>(lists: T[][], key: (t: T) => string): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const l of lists) for (const t of l) if (!seen.has(key(t))) (seen.add(key(t)), out.push(t));
  return out;
};

function combine(answers: { cluster: string; res: SearchResponse }[], listing: boolean): RemoteState {
  const groups: SearchGroup[] = answers.flatMap(({ cluster, res }) =>
    res.groups.map((g) => ({
      slug: g.slug,
      label: g.label,
      total: g.total,
      hits: g.hits.map((h) => ({ score: h.score, obj: { cluster, slug: g.slug, ns: h.ns, name: h.name, clusterScoped: g.clusterScoped } })),
    })),
  );
  const all = answers.map((a) => a.res);
  return {
    groups: mergeGroups(groups, [], { listing }),
    filter: all.find((r) => r.filter)?.filter ?? "",
    pending: union(all.map((r) => r.pending), (s) => s),
    onDemand: union(all.map((r) => r.onDemand), (s) => s),
    truncated: union(all.map((r) => r.truncated), (s) => s),
    denied: union(all.map((r) => r.denied), (d) => d.label + d.reason),
    loading: false,
    error: "",
  };
}

/**
 * What the engine finds in the given clusters for the typed text: the kinds the
 * app does not hold in memory (Services, Ingresses, ConfigMaps, custom
 * resources...). Idle unless the palette is open and the text asks for
 * something the palette can't answer itself.
 */
export function usePaletteRemote(open: boolean, clusters: string[], q: string): RemoteState {
  const [state, setState] = useState<RemoteState>(EMPTY);
  const key = clusters.join("\u0000");

  useEffect(() => {
    const parsed = parseQuery(q);
    const asks = open && clusters.length > 0 && (parsed.terms.length > 0 || parsed.slug !== null) && !(parsed.slug !== null && LOCAL.has(parsed.slug));
    if (!asks) {
      setState((s) => (s === EMPTY ? s : EMPTY));
      return;
    }
    const listing = parsed.terms.length === 0;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const run = async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const answers = await Promise.all(clusters.map(async (cluster) => ({ cluster, res: await searchApi.search(cluster, q, ctrl.signal) })));
        if (ctrl.signal.aborted) return;
        setState(combine(answers, listing));
        if (answers.some((a) => a.res.pending.length > 0) && polls++ < MAX_POLLS) timer = setTimeout(run, POLL_MS);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setState({ ...EMPTY, error: e instanceof Error ? e.message : String(e) });
      }
    };
    timer = setTimeout(run, DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [open, key, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
