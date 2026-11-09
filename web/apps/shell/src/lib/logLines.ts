// Root backlog #22: what a log line says about itself, so the log view can
// colour it the way log tools do (Loki, Kibana, Lens): by the level it was
// logged at, and by the ANSI colours the app printed. Pure; LogLine renders it.

export type LogLevel = "fatal" | "error" | "warn" | "success" | "info" | "debug" | "trace" | "";

// A CSI sequence (colours, cursor moves, erase) or an OSC one (window title).
const ESCAPES = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** The line as a reader sees it, without escape codes. */
export function stripAnsi(line: string): string {
  return line.includes("\x1b") ? line.replace(ESCAPES, "") : line;
}

const LEVEL_WORDS: Record<string, LogLevel> = {
  fatal: "fatal", panic: "fatal", dpanic: "fatal", crit: "fatal", critical: "fatal", emerg: "fatal", emergency: "fatal", alert: "fatal",
  error: "error", err: "error", eror: "error",
  warn: "warn", warning: "warn",
  info: "info", information: "info", informational: "info", notice: "info",
  debug: "debug", dbug: "debug", dbg: "debug",
  trace: "trace", trc: "trace",
};

// level=warn, "level":"error", "severity":"WARNING", lvl=crit
const LEVEL_FIELD = /["']?\b(?:level|lvl|severity|loglevel)["']?\s*[:=]\s*["']?([A-Za-z]+)/i;
// klog / glog: E1109 10:00:00.000000
const KLOG = /^([IWEF])\d{4} \d{2}:\d{2}:\d{2}/;
const KLOG_LEVEL: Record<string, LogLevel> = { I: "info", W: "warn", E: "error", F: "fatal" };

const FATAL = /\b(?:FATAL|PANIC|CRITICAL|CRIT|EMERG(?:ENCY)?|ALERT)\b|^panic:/;
const ERROR = /\b(?:ERROR|ERR|Error)\b|[a-z](?:Exception|Error)\b|^Traceback \(most recent call last\)/;
const WARN = /\b(?:WARN|WARNING|Warning)\b/;
const SUCCESS = /\b(?:success(?:ful(?:ly)?)?|succeeded|listening on|ready to accept|is ready|are ready|now ready)\b/i;
const INFO = /\b(?:INFO|NOTICE)\b/;
const DEBUG = /\b(?:DEBUG|DBG)\b/;
const TRACE = /\bTRACE\b/;

/**
 * The level a line was logged at. A level field (JSON, logfmt) or a klog
 * prefix wins; otherwise the level word in caps, or an exception. An info
 * line that says something worked is "success".
 */
export function logLevel(raw: string): LogLevel {
  const line = stripAnsi(raw);
  const field = LEVEL_FIELD.exec(line);
  const said = field ? LEVEL_WORDS[field[1]!.toLowerCase()] : undefined;
  const klog = KLOG.exec(line);
  const stated = said ?? (klog ? KLOG_LEVEL[klog[1]!] : undefined);
  if (stated) return stated === "info" && SUCCESS.test(line) ? "success" : stated;
  if (FATAL.test(line)) return "fatal";
  if (ERROR.test(line)) return "error";
  if (WARN.test(line)) return "warn";
  if (SUCCESS.test(line)) return "success";
  if (INFO.test(line)) return "info";
  if (DEBUG.test(line)) return "debug";
  if (TRACE.test(line)) return "trace";
  return "";
}

export type AnsiColor = "" | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white";

export interface AnsiSegment {
  text: string;
  color: AnsiColor;
  bold: boolean;
  dim: boolean;
}

const COLORS: AnsiColor[] = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

/**
 * The runs of a line in the colours its app printed (SGR codes: the eight
 * colours and their bright forms, bold, dim). 256-colour and true-colour runs
 * stay in the line's colour, since the theme has no match for them; other
 * escapes are dropped. Adjacent runs in the same style are one run.
 */
export function ansiSegments(line: string): AnsiSegment[] {
  const out: AnsiSegment[] = [];
  let style = { color: "" as AnsiColor, bold: false, dim: false };
  const push = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.color === style.color && last.bold === style.bold && last.dim === style.dim) last.text += text;
    else out.push({ text, ...style });
  };
  let at = 0;
  for (const m of line.matchAll(ESCAPES)) {
    push(line.slice(at, m.index));
    at = m.index! + m[0].length;
    const seq = m[0];
    if (!seq.startsWith("\x1b[") || !seq.endsWith("m")) continue;
    const codes = seq.slice(2, -1).split(";").map((c) => (c === "" ? 0 : Number(c)));
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!;
      if (c === 0) style = { color: "", bold: false, dim: false };
      else if (c === 1) style = { ...style, bold: true };
      else if (c === 2) style = { ...style, dim: true };
      else if (c === 22) style = { ...style, bold: false, dim: false };
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) style = { ...style, color: COLORS[c % 10]! };
      else if (c === 39) style = { ...style, color: "" };
      else if (c === 38 || c === 48) {
        if (c === 38) style = { ...style, color: "" };
        i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
      }
    }
  }
  push(line.slice(at));
  return out.length > 0 ? out : [{ text: "", color: "", bold: false, dim: false }];
}
