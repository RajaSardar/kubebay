import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { DEFS, EXTRA_DEFS } from "../lib/resources";
import { IconButton } from "@kubebay/ui";

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

export function FavoritesSidebar({ favorites, onRemove }: { favorites: string[]; onRemove: (path: string) => void }) {
  if (!favorites.length) return null;

  return (
    <div className="favorites-sidebar">
      <div className="favorites-header">
        <span className="nav-section">Favorites</span>
      </div>
      <div className="favorites-list">
        {favorites.map((fav) => (
          <div key={fav} className="favorites-item">
            <NavLink
              to={fav}
              className={({ isActive }) => (isActive ? "favorites-link active" : "favorites-link")}
            >
              {labelFor(fav)}
            </NavLink>
            <IconButton
              label="Remove from favorites"
              className="favorites-remove"
              onClick={(e) => {
                e.preventDefault();
                onRemove(fav);
              }}
            >
              ×
            </IconButton>
          </div>
        ))}
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
