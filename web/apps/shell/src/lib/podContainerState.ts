export interface LastStateDetail {
  reason: string;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Human-readable "how long the previous instance ran", e.g. "2m 13s". Null if either timestamp is missing. */
  ranFor: string | null;
}

function formatRanFor(startedAt: string, finishedAt: string): string | null {
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Describes a container's `status.lastState`, the previous (usually
// crashed) instance — Kubernetes only ever populates this with a
// `terminated` entry, never `running`/`waiting`, so any other shape means
// there is nothing to report.
export function describeLastState(lastState: Record<string, unknown> | undefined): LastStateDetail | null {
  const terminated = lastState?.terminated as Record<string, unknown> | undefined;
  if (!terminated) return null;

  const startedAt = typeof terminated.startedAt === "string" ? terminated.startedAt : null;
  const finishedAt = typeof terminated.finishedAt === "string" ? terminated.finishedAt : null;

  return {
    reason: typeof terminated.reason === "string" ? terminated.reason : "",
    exitCode: typeof terminated.exitCode === "number" ? terminated.exitCode : null,
    startedAt,
    finishedAt,
    ranFor: startedAt && finishedAt ? formatRanFor(startedAt, finishedAt) : null,
  };
}
