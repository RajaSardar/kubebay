// Backlog #60: the logs view's text filter and its "warnings and errors only"
// checkbox. A line counts as a problem when lib/logLevels reads it as warn or
// error; lines in a format we cannot read are hidden by the checkbox, and
// counted so the view can say how many.
import { logLevel, stripAnsi } from "./logLevels";

export interface LogFilter {
  text: string;
  problemsOnly: boolean;
}

export function isProblemLine(line: string): boolean {
  const l = logLevel(line);
  return l === "warn" || l === "error";
}

/** Items whose line passes the filters, and how many matched the text but were hidden by the level filter. */
export function filterLogItems<T>(items: readonly T[], textOf: (item: T) => string, f: LogFilter): { shown: T[]; hidden: number } {
  const shown: T[] = [];
  let hidden = 0;
  for (const item of items) {
    const l = textOf(item);
    // Filter on the text you see, not on an app's escape codes.
    if (f.text && !stripAnsi(l).includes(f.text)) continue;
    if (f.problemsOnly && !isProblemLine(l)) {
      hidden++;
      continue;
    }
    shown.push(item);
  }
  return { shown, hidden };
}

/** Lines that pass the filters, and how many matched the text but were hidden by the level filter. */
export function filterLogLines(lines: readonly string[], f: LogFilter): { shown: string[]; hidden: number } {
  return filterLogItems(lines, (l) => l, f);
}
