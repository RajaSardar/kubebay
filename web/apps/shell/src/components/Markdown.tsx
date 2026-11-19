import type { ReactNode } from "react";

/**
 * A small Markdown renderer for text a third party wrote (a chart's README).
 *
 * It builds React elements and never sets HTML, so nothing in the source can
 * become a script, a handler, a frame or a style. Raw HTML tags are dropped and
 * their text kept. An image is shown as its alt text, never loaded: the shell's
 * CSP forbids it, and a README image would tell its host who read it. A link is
 * live only for http, https and mailto, and opens in a new tab with
 * noopener and noreferrer. Anything it does not understand shows as text.
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

function blocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const startsBlock = (l: string) =>
    !l.trim() || HEADING.test(l) || FENCE.test(l) || UL.test(l) || OL.test(l) || RULE.test(l) || QUOTE.test(l);

  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${k++}`;
    if (!line.trim()) {
      i++;
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
      while (i < lines.length && !startsBlock(lines[i]!)) body.push(lines[i++]!);
      out.push(<p key={key}>{inline(body.join(" "), key)}</p>);
    }
  }
  return out;
}

export function Markdown({ source }: { source: string }) {
  return <div className="markdown">{blocks(source)}</div>;
}
