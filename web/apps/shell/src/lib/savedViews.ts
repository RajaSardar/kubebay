import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useClusterStore } from "./cluster-store";
import { useNamespaceStore } from "./namespace-store";

/**
 * KB-16: a named view of a resource table, kept locally and shareable as a
 * file: which cluster, kind and namespaces, the filter (lib/filterQuery's
 * key:value language), and the table's columns and sort. Applying one writes
 * the same per-table preferences the table already keeps, so the table needs
 * no new state of its own.
 */
export interface SavedView {
  id: string;
  name: string;
  cluster: string;
  /** The /r/:kind slug ("deployments", "ext--…"). */
  kind: string;
  /** Empty: all namespaces. */
  namespaces: string[];
  filter: string;
  columns?: { order: string[]; hidden: string[] };
  sort?: { col: string | null; asc: boolean };
}

export type ViewDraft = Omit<SavedView, "id">;

export const VIEWS_FILE_KIND = "kubebay.savedViews";

// The table keys ResourceTable gives its list (sortKey r/<kind>).
const sortKey = (kind: string) => `kb.sort.r/${kind}`;
const colsKey = (kind: string) => `kb.cols.r/${kind}`;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readJSON(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

function readSort(v: unknown): SavedView["sort"] {
  const s = v as { col?: unknown; asc?: unknown } | null;
  return s && (typeof s.col === "string" || s.col === null) && typeof s.asc === "boolean" ? { col: s.col, asc: s.asc } : undefined;
}

function readColumns(v: unknown): SavedView["columns"] {
  const c = v as { order?: unknown; hidden?: unknown } | null;
  return c && strings(c.order) && strings(c.hidden) ? { order: c.order, hidden: c.hidden } : undefined;
}

/** A view of what the table shows now, with the layout it has saved. */
export function captureView(v: { name: string; cluster: string; kind: string; namespaces: string[]; filter: string }): ViewDraft {
  const out: ViewDraft = { name: v.name, cluster: v.cluster, kind: v.kind, namespaces: [...v.namespaces], filter: v.filter };
  const sort = readSort(readJSON(sortKey(v.kind)));
  const columns = readColumns(readJSON(colsKey(v.kind)));
  if (sort) out.sort = sort;
  if (columns) out.columns = columns;
  return out;
}

/**
 * Makes a view current: its cluster, namespaces, sort and columns. Returns
 * the table's path with the filter; `view` makes the table read it all again.
 */
export function applyView(v: SavedView): string {
  try {
    if (v.sort) localStorage.setItem(sortKey(v.kind), JSON.stringify(v.sort));
    else localStorage.removeItem(sortKey(v.kind));
    if (v.columns) localStorage.setItem(colsKey(v.kind), JSON.stringify({ v: 1, ...v.columns }));
    else localStorage.removeItem(colsKey(v.kind));
  } catch {
    /* storage unavailable: the view still opens, in the table's current layout */
  }
  const ns = useNamespaceStore.getState();
  if (v.namespaces.length) ns.setNamespaces(v.cluster, v.namespaces);
  else ns.clearNamespaces(v.cluster);
  if (useClusterStore.getState().active !== v.cluster) useClusterStore.getState().setActive(v.cluster);
  const q = v.filter ? `q=${encodeURIComponent(v.filter)}&` : "";
  return `/r/${v.kind}?${q}view=${v.id}`;
}

interface SavedViewsState {
  views: SavedView[];
  add: (v: ViewDraft) => SavedView;
  remove: (id: string) => void;
  /** Adds views, replacing one with the same id, or the same name, cluster and kind. */
  importViews: (views: SavedView[]) => { added: number; replaced: number };
}

export const useSavedViews = create<SavedViewsState>()(
  persist(
    (set, get) => ({
      views: [],
      add: (draft) => {
        const v = { ...draft, id: newId() };
        set({ views: [...get().views, v] });
        return v;
      },
      remove: (id) => set({ views: get().views.filter((v) => v.id !== id) }),
      importViews: (incoming) => {
        const views = [...get().views];
        let added = 0;
        let replaced = 0;
        for (const v of incoming) {
          const i = views.findIndex((x) => x.id === v.id || (x.name === v.name && x.cluster === v.cluster && x.kind === v.kind));
          if (i >= 0) {
            views[i] = { ...v, id: views[i]!.id };
            replaced++;
          } else {
            views.push(v);
            added++;
          }
        }
        set({ views });
        return { added, replaced };
      },
    }),
    { name: "kb.views", version: 1 },
  ),
);

/** The file a team keeps in git: `kubebay.savedViews` version 1. */
export function exportViews(views: SavedView[]): string {
  return JSON.stringify({ kind: VIEWS_FILE_KIND, version: 1, views }, null, 2) + "\n";
}

const KIND_RE = /^[A-Za-z0-9._-]{1,200}$/;

function validView(x: unknown): SavedView | null {
  const v = x as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return null;
  const { name, cluster, kind, namespaces, filter } = v;
  if (typeof name !== "string" || !name.trim() || name.length > 100) return null;
  if (typeof cluster !== "string" || !cluster || cluster.length > 253) return null;
  if (typeof kind !== "string" || !KIND_RE.test(kind)) return null;
  if (!strings(namespaces) || typeof filter !== "string" || filter.length > 500) return null;
  if (v.columns !== undefined && !readColumns(v.columns)) return null;
  if (v.sort !== undefined && !readSort(v.sort)) return null;
  const out: SavedView = { id: typeof v.id === "string" && v.id ? v.id : newId(), name: name.trim(), cluster, kind, namespaces, filter };
  const columns = readColumns(v.columns);
  const sort = readSort(v.sort);
  if (columns) out.columns = columns;
  if (sort) out.sort = sort;
  return out;
}

/** Reads a saved-views file, or says what's wrong with it. */
export function parseViewsFile(text: string): { views: SavedView[] } | { error: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { error: "The file isn't JSON." };
  }
  const d = doc as { kind?: unknown; version?: unknown; views?: unknown } | null;
  if (!d || d.kind !== VIEWS_FILE_KIND) return { error: "This isn't a file of Kubebay saved views." };
  if (d.version !== 1) return { error: `This saved-views file is version ${String(d.version)}; this Kubebay reads version 1.` };
  if (!Array.isArray(d.views)) return { error: "The file has no list of views." };
  const views: SavedView[] = [];
  for (const [i, raw] of d.views.entries()) {
    const v = validView(raw);
    if (!v) return { error: `view ${i + 1} is incomplete or malformed: it needs a name, a cluster, a resource kind, namespaces and a filter.` };
    views.push(v);
  }
  return { views };
}
