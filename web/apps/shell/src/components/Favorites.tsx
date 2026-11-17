import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { DEFS, EXTRA_DEFS, lookupDef } from "../lib/resources";
import { api } from "../lib/api";
import { useClusterStore } from "../lib/cluster-store";
import { targetFor } from "../lib/objectPath";
import { usePersistedFlag } from "../lib/usePersistedFlag";
import { DisclosureButton, IconButton, navItemClass } from "@kubebay/ui";

const FAV_KEY = "kb.favorites";

function loadFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch {
    return [];
  }
}

const FAV_EVENT = "kb:favorites-changed";

// Every useFavorites() caller (the sidebar, each star) holds its own copy, so a
// save announces itself and the others reload; otherwise a new star would not
// reach the sidebar until the next launch.
function saveFavorites(favs: string[]) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  window.dispatchEvent(new Event(FAV_EVENT));
}

const ROUTE_LABELS: Record<string, string> = {
  "/": "Overview",
  "/workloads": "Pods",
  "/workloads-overview": "Workloads Overview",
  "/ports": "Port Forwards",
  "/helm": "Helm",
  "/rbac": "RBAC",
  "/vulnerabilities": "Vulnerabilities",
  "/timeline": "Timeline",
  "/topology": "Topology",
  "/settings": "Settings",
};

function labelFor(path: string): string {
  if (ROUTE_LABELS[path]) return ROUTE_LABELS[path];
  const g = path.match(/^\/crds\?(.*)$/);
  const group = g ? new URLSearchParams(g[1]).get("group") : null;
  if (group) return group;
  const m = path.match(/^\/r\/([^?]+)/);
  if (m && m[1]) {
    const slug = m[1];
    const def = DEFS[slug] ?? EXTRA_DEFS[slug];
    if (def) return def.label;
    // A CRD shortcut is labelled by its plural, e.g. "applications".
    if (slug.startsWith("ext--")) return slug.split("--").pop() || slug;
    return slug
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return path;
}

export function useFavorites() {
  const [favorites, setFavorites] = useState(loadFavorites);

  // Read-modify-write against storage (the source of truth) and announce it, so
  // every other useFavorites() caller reloads.
  const update = useCallback((fn: (prev: string[]) => string[]) => {
    saveFavorites(fn(loadFavorites()));
  }, []);

  const add = useCallback((path: string) => update((prev) => (prev.includes(path) ? prev : [...prev, path])), [update]);

  const remove = useCallback((path: string) => update((prev) => prev.filter((f) => f !== path)), [update]);

  const toggle = useCallback(
    (path: string) => update((prev) => (prev.includes(path) ? prev.filter((f) => f !== path) : [...prev, path])),
    [update],
  );

  const has = useCallback(
    (path: string) => favorites.includes(path),
    [favorites],
  );

  useEffect(() => {
    const reload = () => setFavorites(loadFavorites());
    reload();
    window.addEventListener(FAV_EVENT, reload);
    return () => window.removeEventListener(FAV_EVENT, reload);
  }, []);

  return { favorites, add, remove, toggle, has };
}

// ──── Starred objects: any resource, by cluster + kind + namespace + name ────
// Kept beside the route favourites above (a separate key), so old favourites
// load exactly as before.

/** One starred object. `slug` is the resource kind's route slug ("pods", "deployments", "ext--..."). */
export interface FavObject {
  cluster: string;
  slug: string;
  ns: string;
  name: string;
  /** The Kubernetes Kind ("Deployment"), for the row's tooltip. */
  kind?: string;
}

const OBJ_KEY = "kb.favorites.objects";

/** The starred objects, read once (the palette lists them when it opens). */
export function readFavoriteObjects(): FavObject[] {
  return loadObjects();
}

function loadObjects(): FavObject[] {
  try {
    const v = JSON.parse(localStorage.getItem(OBJ_KEY) || "[]") as unknown;
    return Array.isArray(v)
      ? v.filter((o): o is FavObject => !!o && typeof o.cluster === "string" && typeof o.slug === "string" && typeof o.name === "string")
      : [];
  } catch {
    return [];
  }
}

function saveObjects(objs: FavObject[]) {
  localStorage.setItem(OBJ_KEY, JSON.stringify(objs));
  window.dispatchEvent(new Event(FAV_EVENT));
}

const sameObject = (a: FavObject, b: FavObject) =>
  a.cluster === b.cluster && a.slug === b.slug && (a.ns ?? "") === (b.ns ?? "") && a.name === b.name;

export function useFavoriteObjects() {
  const [objects, setObjects] = useState(loadObjects);

  const toggle = useCallback((o: FavObject) => {
    const prev = loadObjects();
    saveObjects(prev.some((x) => sameObject(x, o)) ? prev.filter((x) => !sameObject(x, o)) : [...prev, o]);
  }, []);
  const remove = useCallback((o: FavObject) => saveObjects(loadObjects().filter((x) => !sameObject(x, o))), []);
  const has = useCallback((o: FavObject) => objects.some((x) => sameObject(x, o)), [objects]);

  useEffect(() => {
    const reload = () => setObjects(loadObjects());
    reload();
    window.addEventListener(FAV_EVENT, reload);
    return () => window.removeEventListener(FAV_EVENT, reload);
  }, []);

  return { objects, toggle, remove, has };
}

/** The star for one object, in the drawer header next to Copy name. */
export function ObjectStarButton({ obj }: { obj: FavObject }) {
  const { has, toggle } = useFavoriteObjects();
  const isFav = has(obj);
  return (
    <IconButton
      size="lg"
      label={isFav ? `Remove ${obj.name} from favorites` : `Add ${obj.name} to favorites`}
      className="star-btn"
      active={isFav}
      onClick={() => toggle(obj)}
    >
      {isFav ? "★" : "☆"}
    </IconButton>
  );
}

const objKey = (o: FavObject) => `${o.cluster}|${o.slug}|${o.ns}|${o.name}`;

/** The rows only: route favourites, then starred objects (dimmed when `dead` says they are gone). */
export function FavoritesSidebar({
  favorites,
  onRemove,
  objects = [],
  dead = new Set<string>(),
  onRemoveObject = () => {},
  onOpenObject = () => {},
}: {
  favorites: string[];
  onRemove: (path: string) => void;
  objects?: FavObject[];
  dead?: Set<string>;
  onRemoveObject?: (o: FavObject) => void;
  onOpenObject?: (o: FavObject) => void;
}) {
  return (
    <>
      {favorites.map((fav) => (
        <div key={fav} className="nav-fav">
          <NavLink to={fav} className={({ isActive }) => navItemClass({ active: isActive })}>
            <span>{labelFor(fav)}</span>
          </NavLink>
          <IconButton
            label="Remove from favorites"
            className="nav-fav-remove"
            onClick={(e) => {
              e.preventDefault();
              onRemove(fav);
            }}
          >
            ×
          </IconButton>
        </div>
      ))}
      {objects.map((o) => {
        const isDead = dead.has(objKey(o));
        return (
          <div
            key={objKey(o)}
            className={`nav-fav${isDead ? " nav-fav--dead" : ""}`}
            data-testid={isDead ? `fav-dead-${o.name}` : undefined}
          >
            <NavLink
              to={targetFor(o)}
              className={navItemClass({ active: false })}
              title={`${o.kind ?? o.slug}${o.ns ? ` · ${o.ns}` : ""} · ${o.cluster}${isDead ? " (no longer exists)" : ""}`}
              onClick={() => onOpenObject(o)}
            >
              <span>{o.name}</span>
            </NavLink>
            <IconButton
              label="Remove from favorites"
              className="nav-fav-remove"
              onClick={(e) => {
                e.preventDefault();
                onRemoveObject(o);
              }}
            >
              ×
            </IconButton>
          </div>
        );
      })}
    </>
  );
}

/**
 * The sidebar's Favorites section: collapsible, and rendered from ONE place in
 * App.tsx's Sidebar, so moving it is a one-line change there. Starred objects
 * on the open cluster are looked up once; one the cluster no longer has is dimmed.
 */
export function FavoritesNav() {
  const { favorites, remove } = useFavorites();
  const { objects, remove: removeObject } = useFavoriteObjects();
  const active = useClusterStore((s) => s.active);
  const setActive = useClusterStore((s) => s.setActive);
  const [open, toggleOpen] = usePersistedFlag("kb.sidebar.favorites", true);

  const here = objects.filter((o) => o.cluster === active);
  const checks = useQueries({
    queries: here.map((o) => ({
      queryKey: ["fav-exists", objKey(o)],
      queryFn: async () => {
        const gvr = o.slug === "pods" ? "v1/pods" : lookupDef(o.slug, new URLSearchParams(o.ns ? "" : "scoped=0"))?.gvr;
        if (!gvr) return true;
        try {
          await api.getObject(o.cluster, gvr, o.ns, o.name);
          return true;
        } catch (e) {
          // Only "not found" means gone: forbidden or a flaky network is not a deletion.
          return !/not\s*found|404/i.test(e instanceof Error ? e.message : String(e));
        }
      },
      retry: false,
      staleTime: 60_000,
    })),
  });
  const dead = new Set<string>();
  here.forEach((o, i) => {
    if (checks[i]?.data === false) dead.add(objKey(o));
  });

  const total = favorites.length + objects.length;
  if (total === 0) return null;
  return (
    <div className={`nav-group${open ? " open" : ""}`}>
      <DisclosureButton open={open} onToggle={toggleOpen} count={total}>
        Favorites
      </DisclosureButton>
      <div className="nav-group-items">
        <FavoritesSidebar
          favorites={favorites}
          onRemove={remove}
          objects={objects}
          dead={dead}
          onRemoveObject={removeObject}
          onOpenObject={(o) => o.cluster !== active && setActive(o.cluster)}
        />
      </div>
    </div>
  );
}

/** `name` says what the star is for ("Add Application to favorites"); without it the label is generic. */
export function StarButton({ path, name }: { path: string; name?: string }) {
  const { favorites, toggle } = useFavorites();
  const isFav = favorites.includes(path);

  return (
    <IconButton
      label={isFav ? (name ? `Remove ${name} from favorites` : "Remove from favorites") : name ? `Add ${name} to favorites` : "Add to favorites"}
      className="star-btn"
      active={isFav}
      onClick={() => toggle(path)}
    >
      {isFav ? "★" : "☆"}
    </IconButton>
  );
}
