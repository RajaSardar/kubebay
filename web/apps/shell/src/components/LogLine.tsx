import type { ReactNode } from "react";
import { ansiSegments, logLevel, type LogLevel, type LogTone } from "../lib/logLevels";

// Backlog #22: a log line's class from its level (lib/logLevels).
const LEVEL_CLASS: Record<LogLevel, string> = { error: "err", warn: "warn", success: "ok", info: "info", debug: "debug", "": "" };
const ANSI_CLASS: Record<LogTone, string> = {
  err: "log-ansi-err",
  warn: "log-ansi-warn",
  ok: "log-ansi-ok",
  info: "log-ansi-info",
  muted: "log-ansi-muted",
};

/** A log line, coloured by its level, with an app's own ANSI colours as theme tones. */
export function LogLine({ line, prefix }: { line: string; prefix?: ReactNode }) {
  const level = LEVEL_CLASS[logLevel(line)];
  const segments = ansiSegments(line);
  return (
    <div className={level ? `log-line ${level}` : "log-line"}>
      {prefix}
      {segments
        ? segments.map((seg, i) =>
            seg.tone || seg.bold ? (
              <span key={i} className={[seg.tone && ANSI_CLASS[seg.tone], seg.bold && "log-ansi-bold"].filter(Boolean).join(" ")}>
                {seg.text}
              </span>
            ) : (
              seg.text
            ),
          )
        : line}
    </div>
  );
}
