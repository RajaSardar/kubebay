import type { ReactNode } from "react";
import { DataTable, type Column } from "@kubebay/ui";

/**
 * A small Markdown renderer for text a third party wrote (a chart's README).
 *
 * It builds React elements and never sets HTML, so nothing in the source can
 * become a script, a handler, a frame or a style. Raw HTML tags are dropped and
 * their text kept. An image is shown as its alt text, never loaded: the shell's
 * CSP forbids it, and a README image would tell its host who read it. A link is
 * live only for http, https and mailto, and opens in a new tab with
 * noopener and noreferrer. A GFM pipe table becomes the design system's
 * DataTable, its cells inline Markdown like any other text. Anything it does
 * not understand shows as text.
 */

const HTML_TAG = /<\/?[A-Za-z][^>]*>|<!--[\s\S]*?-->/g;

function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? raw : null;
  } catch {
    return null;
  }
}

// Order matters: an image starts like a link, a code span hides its content.
const INLINE = /(`[^`\n]+`)|(!\[([^\]\n]*)\]\(([^)\s]*)[^)]*\))|(\[([^\]\n]+)\]\(([^)\s]*)[^)]*\))|(\*\*([^*\n]+)\*\*)|(__([^_\n]+)__)|(\*([^*\n]+)\*)|(\b_([^_\n]+)_\b)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const src = text.replace(HTML_TAG, "");
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(src.slice(last, at));
    const key = `${keyBase}-${n++}`;
    if (m[1]) out.push(<code key={key}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<span key={key}>{m[3] || ""}</span>);
    else if (m[5]) {
      const href = safeHref(m[7] ?? "");
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {inline(m[6] ?? "", key)}
          </a>
        ) : (
          <span key={key}>{m[6]}</span>
        ),
      );
    } else if (m[8]) out.push(<strong key={key}>{inline(m[9] ?? "", key)}</strong>);
    else if (m[10]) out.push(<strong key={key}>{inline(m[11] ?? "", key)}</strong>);
    else if (m[12]) out.push(<em key={key}>{inline(m[13] ?? "", key)}</em>);
    else if (m[14]) out.push(<em key={key}>{inline(m[15] ?? "", key)}</em>);
    last = at + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;

// A GFM table's delimiter row: cells of dashes, each with an optional colon at
// either end for its alignment.
const DELIM_CELL = /^\s*(:?)-+(:?)\s*$/;

type Align = "left" | "center" | "right" | undefined;

/** A table row's cells: split on unescaped pipes, outer pipes optional, `\|` a literal pipe. */
function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  for (let j = 0; j < s.length; j++) {
    const c = s[j]!;
    if (c === "\\" && s[j + 1] === "|") {
      cur += "|";
      j++;
    } else if (c === "|") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** The alignments a delimiter row sets, or null when it is not one for this many columns. */
function delimiter(line: string | undefined, columns: number): Align[] | null {
  if (line === undefined || !line.includes("-")) return null;
  const parts = cells(line);
  if (parts.length !== columns || !parts.every((p) => DELIM_CELL.test(p))) return null;
  return parts.map((p) => {
    const [, l, r] = DELIM_CELL.exec(p)!;
    return l && r ? "center" : r ? "right" : l ? "left" : undefined;
  });
}

/** Whether lines[i] opens a table: a row with a pipe, then a matching delimiter row. */
function tableAt(lines: readonly string[], i: number): Align[] | null {
  const head = lines[i];
  if (head === undefined || !head.includes("|")) return null;
  return delimiter(lines[i + 1], cells(head).length);
}

type MdRow = { key: string; cells: string[] };

const endsTable = (l: string) =>
  !l.trim() || HEADING.test(l) || FENCE.test(l) || UL.test(l) || OL.test(l) || RULE.test(l) || QUOTE.test(l);

function table(lines: readonly string[], start: number, aligns: Align[], key: string): { node: ReactNode; next: number } {
  const header = cells(lines[start]!);
  const rows: MdRow[] = [];
  let i = start + 2;
  // As in GFM, a table runs to a blank line or the start of another block.
  while (i < lines.length && !endsTable(lines[i]!)) {
    const row = cells(lines[i]!);
    // A row has the header's columns: a short one is padded, a long one cut.
    rows.push({ key: `${key}-${i}`, cells: header.map((_, c) => row[c] ?? "") });
    i++;
  }
  const columns: Column<MdRow>[] = header.map((h, c) => ({
    key: String(c),
    header: inline(h, `${key}-h${c}`),
    align: aligns[c],
    render: (r) => inline(r.cells[c] ?? "", `${r.key}-${c}`),
  }));
  return {
    node: <DataTable key={key} columns={columns} rows={rows} rowKey={(r) => r.key} textWrap />,
    next: i,
  };
}

function blocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const startsBlock = (l: string, at: number) => endsTable(l) || tableAt(lines, at) !== null;

  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${k++}`;
    const aligns = tableAt(lines, i);
    if (!line.trim()) {
      i++;
    } else if (aligns) {
      const t = table(lines, i, aligns, key);
      out.push(t.node);
      i = t.next;
    } else if (FENCE.test(line)) {
      const fence = FENCE.exec(line)![1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence)) body.push(lines[i++]!);
      i++;
      out.push(
        <pre key={key} className="log-view">
          <code>{body.join("\n")}</code>
        </pre>,
      );
    } else if (HEADING.test(line)) {
      const [, hashes, text] = HEADING.exec(line)!;
      const level = Math.min(hashes!.length, 6);
      const Tag = `h${level}` as "h1";
      out.push(<Tag key={key}>{inline(text ?? "", key)}</Tag>);
      i++;
    } else if (RULE.test(line)) {
      out.push(<hr key={key} />);
      i++;
    } else if (UL.test(line) || OL.test(line)) {
      const ordered = !UL.test(line);
      const re = ordered ? OL : UL;
      const items: ReactNode[] = [];
      while (i < lines.length && re.test(lines[i]!)) {
        items.push(<li key={`${key}-${i}`}>{inline(re.exec(lines[i]!)![1] ?? "", `${key}-${i}`)}</li>);
        i++;
      }
      out.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    } else if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) body.push(QUOTE.exec(lines[i++]!)![1] ?? "");
      out.push(<blockquote key={key}>{blocks(body.join("\n"))}</blockquote>);
    } else {
      const body: string[] = [line];
      i++;
      while (i < lines.length && !startsBlock(lines[i]!, i)) body.push(lines[i++]!);
      out.push(<p key={key}>{inline(body.join(" "), key)}</p>);
    }
  }
  return out;
}

export function Markdown({ source }: { source: string }) {
  return <div className="markdown">{blocks(source)}</div>;
}
