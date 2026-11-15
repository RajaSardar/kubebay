// Backlog #22: what level a log line is at, the way log tools read it, and
// the colours an app wrote into it. The level comes from the line's own
// structure (JSON, logfmt, klog, a bracketed or capitalised level word, an
// exception at its start), never from "error" somewhere in prose.

export type LogLevel = "error" | "warn" | "info" | "debug" | "success" | "";

// Any CSI escape sequence: colours (…m) and cursor or erase codes alike.
const CSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(line: string): string {
  return line.replace(CSI, "");
}

function levelWord(word: string): LogLevel {
  const w = word.toLowerCase();
  if (/^(fatal|panic|crit|critical|emerg|emergency|alert|error|err|severe)$/.test(w)) return "error";
  if (/^(warn|warning)$/.test(w)) return "warn";
  if (/^(info|information|notice)$/.test(w)) return "info";
  if (/^(debug|dbg|trace|verbose)$/.test(w)) return "debug";
  if (w === "success") return "success";
  return "";
}

/** pino and bunyan's numbers: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal. */
function numericLevel(n: number): LogLevel {
  if (n >= 50) return "error";
  if (n >= 40) return "warn";
  if (n >= 30) return "info";
  return "debug";
}

/** The level a line declares, if it declares one. */
function declaredLevel(line: string): LogLevel {
  const json = /"(?:level|lvl|severity|loglevel|log\.level)"\s*:\s*(?:"([A-Za-z]+)"|(\d+))/i.exec(line);
  if (json) return json[1] ? levelWord(json[1]) : numericLevel(Number(json[2]));
  const logfmt = /(?:^|\s)(?:level|lvl|severity)=(?:"([A-Za-z]+)"|([A-Za-z]+))/i.exec(line);
  if (logfmt) return levelWord(logfmt[1] ?? logfmt[2] ?? "");
  const klog = /^([EWIF])\d{4} \d{2}:\d{2}:\d{2}/.exec(line);
  if (klog) return klog[1] === "W" ? "warn" : klog[1] === "I" ? "info" : "error";
  const bracketed = /\[(fatal|panic|crit|critical|error|err|warn|warning|info|notice|debug|dbg|trace|success)\]/i.exec(line);
  if (bracketed) return levelWord(bracketed[1]!);
  const word = /(?:^|[\s|:,(])(FATAL|PANIC|CRITICAL|CRIT|EMERG|ALERT|SEVERE|ERROR|ERR|WARNING|WARN|INFO|NOTICE|DEBUG|DBG|TRACE|SUCCESS)(?=[\s|:,\])]|$)/.exec(line);
  if (word) return levelWord(word[1]!);
  return "";
}

const EXCEPTION = /^\s*(?:(?:[A-Z]\w*)?(?:Error|Exception)\b|Traceback \(most recent call last\)|panic:|fatal error:)/;
const FAILURE = /\b(?:failed|failure)\b/i;
const SUCCESS = /\b(?:succeeded|successfully|success)\b/i;

/**
 * A line's level. A declared error, warning or debug level stands. A line
 * with no level that starts with an exception, or says something failed, is
 * an error. A line at info or no level that says something succeeded is a
 * success.
 */
export function logLevel(raw: string): LogLevel {
  const line = stripAnsi(raw);
  if (!line.trim()) return "";
  const declared = declaredLevel(line);
  if (declared && declared !== "info") return declared;
  if (!declared && (EXCEPTION.test(line) || FAILURE.test(line))) return "error";
  if (SUCCESS.test(line)) return "success";
  return declared;
}

export type LogTone = "err" | "warn" | "ok" | "info" | "muted";

export interface LogSegment {
  text: string;
  tone?: LogTone;
  bold?: boolean;
}

function toneOf(code: number): LogTone | undefined | null {
  // null: this code doesn't set a colour.
  switch (code) {
    case 30:
    case 90:
      return "muted";
    case 31:
    case 91:
      return "err";
    case 32:
    case 92:
      return "ok";
    case 33:
    case 93:
      return "warn";
    case 34:
    case 94:
    case 35:
    case 95:
    case 36:
    case 96:
      return "info";
    case 37:
    case 97:
    case 39:
      return undefined;
    default:
      return null;
  }
}

/**
 * The runs of an app's own colours (ANSI SGR) in a line, as theme tones, or
 * null when it has none. Other escape codes are dropped; 256-colour and RGB
 * colours fall back to the line's own colour.
 */
export function ansiSegments(line: string): LogSegment[] | null {
  if (!line.includes("\x1b[")) return null;
  const out: LogSegment[] = [];
  let tone: LogTone | undefined;
  let bold = false;
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    out.push({ text, ...(tone ? { tone } : {}), ...(bold ? { bold } : {}) });
  };
  for (const m of line.matchAll(/\x1b\[([0-9;?]*)([A-Za-z])/g)) {
    push(line.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] !== "m") continue;
    const codes = (m[1] || "0").split(";").map((c) => Number(c || 0));
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!;
      if (c === 0) {
        tone = undefined;
        bold = false;
      } else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 38 || c === 48) {
        // 256-colour (5;n) or RGB (2;r;g;b): skip its arguments.
        if (c === 38) tone = undefined;
        i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
      } else {
        const t = toneOf(c);
        if (t !== null) tone = t;
      }
    }
  }
  push(line.slice(last));
  return out;
}
