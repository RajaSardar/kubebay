export interface Recent {
  cluster: string;
  slug: string;
  ns: string;
  name: string;
}

const KEY = "kb.paletteRecents";
const MAX = 6;

export function readRecents(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v)
      ? v.filter((r): r is Recent => !!r && typeof r.cluster === "string" && typeof r.slug === "string" && typeof r.name === "string").slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

/** Puts what you just opened first, once. */
export function pushRecent(r: Recent): void {
  const same = (x: Recent) => x.cluster === r.cluster && x.slug === r.slug && x.ns === r.ns && x.name === r.name;
  try {
    localStorage.setItem(KEY, JSON.stringify([r, ...readRecents().filter((x) => !same(x))].slice(0, MAX)));
  } catch {
    /* storage full or blocked: recents are a convenience */
  }
}
