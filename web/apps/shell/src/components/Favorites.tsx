import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

const FAV_KEY = "kb.favorites";

function loadFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveFavorites(favs: string[]) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
}

const ROUTE_LABELS: Record<string, string> = {
  "/": "Overview",
  "/fleet": "Fleet",
  "/workloads": "Pods",
  "/workloads-overview": "Workloads Overview",
  "/ports": "Port Forwards",
  "/helm": "Helm",
  "/rbac": "RBAC",
  "/timeline": "Timeline",
  "/topology": "Topology",
  "/settings": "Settings",
};

function labelFor(path: string): string {
  if (ROUTE_LABELS[path]) return ROUTE_LABELS[path];
  const m = path.match(/^\/r\/(.+)$/);
  if (m) {
    return m[1]
      .replace(/^ext--/, "")
      .replace(/--/g, "/")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return path;
}

export function useFavorites() {
  const [favorites, setFavorites] = useState(loadFavorites);

  const add = useCallback(
    (path: string) => {
      setFavorites((prev) => {
        if (prev.includes(path)) return prev;
        const next = [...prev, path];
        saveFavorites(next);
        return next;
      });
    },
    [],
  );

  const remove = useCallback(
    (path: string) => {
      setFavorites((prev) => {
        const next = prev.filter((f) => f !== path);
        saveFavorites(next);
        return next;
      });
    },
    [],
  );

  const toggle = useCallback(
    (path: string) => {
      setFavorites((prev) => {
        const next = prev.includes(path) ? prev.filter((f) => f !== path) : [...prev, path];
        saveFavorites(next);
        return next;
      });
    },
    [],
  );

  const has = useCallback(
    (path: string) => favorites.includes(path),
    [favorites],
  );

  useEffect(() => {
    setFavorites(loadFavorites());
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
            <button
              className="favorites-remove"
              onClick={(e) => {
                e.preventDefault();
                onRemove(fav);
              }}
              title="Remove from favorites"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StarButton({ path }: { path: string }) {
  const { favorites, toggle } = useFavorites();
  const isFav = favorites.includes(path);

  return (
    <button
      className={`star-btn${isFav ? " starred" : ""}`}
      onClick={() => toggle(path)}
      title={isFav ? "Remove from favorites" : "Add to favorites"}
    >
      {isFav ? "★" : "☆"}
    </button>
  );
}
