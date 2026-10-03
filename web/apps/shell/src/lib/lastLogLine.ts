const MAX = 160;
// A runtime timestamp some log pipelines prefix ("2026-10-03T18:01:02.123Z ").
const LEADING_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})\s+/;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * The last line of a log tail worth reading on the Overview: the last one with
 * text in it, without its timestamp or colour codes, cut to fit one row.
 * Null when the tail has nothing to show.
 */
export function lastLogLine(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i]!.replace(ANSI, "").trim().replace(LEADING_TS, "").trim();
    if (!text) continue;
    return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
  }
  return null;
}
