/**
 * Pure helpers for the local shell. Kept out of the terminal component so they
 * can be tested (and imported by the app shell) without pulling in xterm.
 */

const PROD_WORDS = new Set(["prd", "prod", "live", "production"]);

/**
 * A name check, nothing more. It reads the cluster id and context name and
 * says whether they *look* like production. It cannot see what the cluster
 * actually is, so a false here means nothing and a true is only a prompt to
 * look again. Never present it as a safety guarantee.
 */
export function looksProduction(...names: (string | undefined)[]): boolean {
  return names
    .filter((n): n is string => !!n)
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((word) => PROD_WORDS.has(word) || /^prod[0-9]*$/.test(word));
}

/** Why a chan-closed ended the session, as far as the UI needs to care. */
export type ShellEnd =
  | { kind: "unsupported"; detail: string }
  | { kind: "exit"; code: number }
  | { kind: "error"; detail: string };

// A default engine build never reaches runLocalShell: validChanKind drops
// "local-shell" in hub.go and answers the chan-open with an `error` frame
// reading "invalid channel kind". Only a build that carries the tag but has the
// feature switched off replies on chan-closed. Both mean the same thing to a
// user — there is no shell here — so both land on "unsupported".
const UNSUPPORTED_RE =
  /not built into this binary|local shell is (not enabled|disabled)|invalid channel kind/i;

/**
 * The engine sends "exit code N" when the shell ran and stopped, and an error
 * string otherwise. Some of those errors mean the feature is not there at all,
 * which is a different screen from a shell that died.
 */
export function classifyShellEnd(message: string | undefined): ShellEnd {
  const msg = (message ?? "").trim();
  const exit = /^exit code (-?\d+)$/.exec(msg);
  if (exit) return { kind: "exit", code: Number(exit[1]) };
  if (UNSUPPORTED_RE.test(msg)) return { kind: "unsupported", detail: msg };
  return { kind: "error", detail: msg || "the session ended unexpectedly" };
}

/** How an exit code reads to a person. */
export function describeExit(code: number): string {
  if (code === 0) return "exit 0";
  if (code >= 128 && code < 160) return `terminated by signal ${code - 128}`;
  if (code < 0) return "ended without an exit code";
  return `exit ${code}`;
}

/** The kubeconfig context a shell is pinned to, captured when it was opened. */
export interface ShellBinding {
  cluster: string;
  context: string;
}

/** Just enough of ClusterInfo to resolve a context name, so tests need no fixtures. */
export interface ClusterRef {
  id: string;
  context?: string;
}

/**
 * The context name to show for a cluster id. Falls back to the id: a cluster
 * list that has not loaded yet has no context to offer, and the id is better
 * than a blank in a banner whose whole job is naming what kubectl will hit.
 */
export function contextOf(id: string, clusters: readonly ClusterRef[]): string {
  return clusters.find((c) => c.id === id)?.context || id;
}

/** The binding to record when a shell is opened against `id`. */
export function bindTo(id: string, clusters: readonly ClusterRef[]): ShellBinding {
  return { cluster: id, context: contextOf(id, clusters) };
}

/** Whether a binding looks like production. Advisory only — see looksProduction. */
export function bindingLooksProduction(b: ShellBinding | null): boolean {
  return !!b && looksProduction(b.cluster, b.context);
}

/**
 * Whether the app's selected cluster has moved away from what this shell is
 * bound to. The shell never follows the picker, so this only decides whether to
 * *offer* a new session. `dismissedTarget` is the cluster the user already
 * declined, so the banner stops asking about that one instead of nagging.
 */
export function isStale(
  bound: ShellBinding | null,
  selectedCluster: string,
  dismissedTarget: string,
): boolean {
  if (!bound || !selectedCluster) return false;
  return bound.cluster !== selectedCluster && dismissedTarget !== selectedCluster;
}
