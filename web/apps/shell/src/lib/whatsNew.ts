import data from "../generated/whatsnew.json";

/** One changelog entry: the bold lead and the first sentence after it. */
export interface WhatsNewItem {
  title: string;
  summary: string;
}
export interface WhatsNewSection {
  heading: string;
  items: WhatsNewItem[];
}
export interface WhatsNewRelease {
  version: string;
  date: string;
  sections: WhatsNewSection[];
}

/** Parsed from CHANGELOG.md by scripts/whatsnew-gen.mjs (the shell's prebuild runs it). */
export const WHATS_NEW_RELEASES: WhatsNewRelease[] = (data as { releases: WhatsNewRelease[] }).releases;

export const LAST_SEEN_KEY = "kb.lastSeenVersion";

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(v: string) {
  const m = SEMVER.exec(v.trim());
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] } : null;
}

/** <0, 0 or >0 like a comparator; null when either side isn't a semantic version ("dev"). */
export function compareSemver(a: string, b: string): number | null {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i]! - y.n[i]!;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; // a release is newer than its pre-release
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * The releases a user has not seen: lastSeen < version <= current, newest first.
 * Nothing on a first run (no lastSeen: the caller records the current version),
 * on equal versions, after a downgrade, or when either version isn't semver (dev builds).
 */
export function releasesToShow(releases: WhatsNewRelease[], lastSeen: string | null, current: string): WhatsNewRelease[] {
  if (!lastSeen) return [];
  const newer = compareSemver(current, lastSeen);
  if (newer === null || newer <= 0) return [];
  return releases
    .filter((r) => {
      const afterSeen = compareSemver(r.version, lastSeen);
      const uptoCurrent = compareSemver(r.version, current);
      return afterSeen !== null && afterSeen > 0 && uptoCurrent !== null && uptoCurrent <= 0;
    })
    .sort((a, b) => compareSemver(b.version, a.version) ?? 0);
}

export function readLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function writeLastSeen(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    /* storage unavailable: the window shows again next start */
  }
}
