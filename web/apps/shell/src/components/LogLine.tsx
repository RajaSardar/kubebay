import { memo } from "react";
import { ansiSegments, logLevel, type AnsiColor, type LogLevel } from "../lib/logLines";

const LINE_CLASS: Record<LogLevel, string> = {
  fatal: "log-line log-fatal",
  error: "log-line log-error",
  warn: "log-line log-warn",
  success: "log-line log-success",
  info: "log-line log-info",
  debug: "log-line log-debug",
  trace: "log-line log-trace",
  "": "log-line",
};

const ANSI_CLASS: Record<AnsiColor, string> = {
  "": "",
  black: "ansi-black",
  red: "ansi-red",
  green: "ansi-green",
  yellow: "ansi-yellow",
  blue: "ansi-blue",
  magenta: "ansi-magenta",
  cyan: "ansi-cyan",
  white: "ansi-white",
};

/**
 * One line of a pod's log, coloured by its level (error red, warning amber,
 * success green, debug dim), with the app's own ANSI colours shown in the
 * theme's colours (root backlog #22). Memoised: a streaming log re-renders
 * only its new lines.
 */
export const LogLine = memo(function LogLine({ line }: { line: string }) {
  return (
    <div className={LINE_CLASS[logLevel(line)]}>
      {line.includes("\x1b")
        ? ansiSegments(line).map((s, i) => {
            const cls = [ANSI_CLASS[s.color], s.bold && "ansi-bold", s.dim && "ansi-dim"].filter(Boolean).join(" ");
            return cls ? (
              <span key={i} className={cls}>
                {s.text}
              </span>
            ) : (
              s.text
            );
          })
        : line}
    </div>
  );
});
