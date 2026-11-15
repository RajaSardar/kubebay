import { parseCpuMillis, parseMemBytes } from "./rightsizing";

export interface DangerousChange {
  kind:
    | "limits-shrunk-cpu"
    | "limits-shrunk-memory"
    | "budget-nodes-lowered"
    | "consolidation-policy-to-when-empty-or-underutilized";
  message: string;
}

interface KeyBlock {
  inline: string;
  body: string;
}

function stripComment(line: string): string {
  const idx = line.indexOf("#");
  return idx === -1 ? line : line.slice(0, idx);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Finds `key:` at the top (minimum-indent) level of `text` — never a
 * same-named key nested deeper inside a sibling block — and returns its
 * inline value plus the body of lines that belong to it (indented deeper,
 * up to the next line back at or above that indent).
 */
function findKeyBlock(text: string, key: string): KeyBlock | undefined {
  const rawLines = text.split("\n");
  const lines = rawLines
    .map((l) => stripComment(l).replace(/\s+$/, ""))
    .map((content, i) => ({ content, indent: content.trim() === "" ? -1 : indentOf(content), raw: rawLines[i] ?? "" }))
    .filter((l) => l.indent >= 0);
  if (lines.length === 0) return undefined;

  const minIndent = Math.min(...lines.map((l) => l.indent));
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.*)$`);

  const match = lines.find((l) => l.indent === minIndent && keyRe.test(l.content.trim()));
  if (!match) return undefined;
  const m = match.content.trim().match(keyRe);
  if (!m) return undefined;

  const inline = (m[1] ?? "").trim();
  const bodyLines: string[] = [];
  let seenMatch = false;
  for (const l of lines) {
    if (l === match) {
      seenMatch = true;
      continue;
    }
    if (!seenMatch) continue;
    if (l.indent <= minIndent) break;
    bodyLines.push(l.raw);
  }
  return { inline, body: bodyLines.join("\n") };
}

function scalarAtPath(yaml: string, path: string[]): string | undefined {
  let scope = yaml;
  for (const [i, key] of path.entries()) {
    const block = findKeyBlock(scope, key);
    if (!block) return undefined;
    if (i === path.length - 1) return unquote(block.inline) || undefined;
    scope = block.body;
  }
  return undefined;
}

function blockAtPath(yaml: string, path: string[]): string | undefined {
  let scope = yaml;
  for (const key of path) {
    const block = findKeyBlock(scope, key);
    if (!block) return undefined;
    scope = block.body;
  }
  return scope;
}

function unquote(v: string): string {
  const m = v.match(/^"(.*)"$|^'(.*)'$/);
  return m ? (m[1] ?? m[2] ?? "") : v;
}

/** Splits a sequence block's body into one text chunk per `- ` item. */
function sequenceItems(body: string): string[] {
  const lines = body.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const minIndent = Math.min(...lines.map(indentOf));

  const items: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    const indent = indentOf(line);
    const trimmed = line.trimStart();
    if (indent === minIndent && trimmed.startsWith("- ")) {
      if (current.length) items.push(current.join("\n"));
      current = [" ".repeat(indent + 2) + trimmed.slice(2)];
    } else {
      current.push(line);
    }
  }
  if (current.length) items.push(current.join("\n"));
  return items;
}

function budgetNodesValues(yaml: string): string[] {
  const body = blockAtPath(yaml, ["spec", "disruption", "budgets"]);
  if (!body) return [];
  return sequenceItems(body)
    .map((item) => scalarAtPath(item, ["nodes"]))
    .filter((v): v is string => v !== undefined);
}

/** Compares like-for-like: percentages against percentages, counts against counts. */
function isLower(before: string, after: string): boolean | undefined {
  const beforePct = before.trim().endsWith("%");
  const afterPct = after.trim().endsWith("%");
  if (beforePct !== afterPct) return undefined;
  const b = parseFloat(before);
  const a = parseFloat(after);
  if (Number.isNaN(b) || Number.isNaN(a)) return undefined;
  return a < b;
}

/**
 * Detects the three NodePool edits the backlog (#3 P2) flags as
 * eviction-causing, comparing the raw YAML text a user is about to apply
 * against what's currently on the cluster. Deliberately hand-rolled
 * scoped-block text extraction rather than a YAML parsing dependency,
 * consistent with this codebase's zero-new-deps pattern — good enough for
 * a safety gate that only needs to read three well-known NodePool fields,
 * never a general-purpose YAML diff.
 */
export function detectDangerousChanges(originalYaml: string, modifiedYaml: string): DangerousChange[] {
  const findings: DangerousChange[] = [];

  const beforeCpu = scalarAtPath(originalYaml, ["spec", "limits", "cpu"]);
  const afterCpu = scalarAtPath(modifiedYaml, ["spec", "limits", "cpu"]);
  if (beforeCpu && afterCpu && parseCpuMillis(afterCpu) < parseCpuMillis(beforeCpu)) {
    findings.push({
      kind: "limits-shrunk-cpu",
      message: `spec.limits.cpu is shrinking (${beforeCpu} → ${afterCpu}) — pods may become unschedulable once existing nodes are replaced.`,
    });
  }

  const beforeMem = scalarAtPath(originalYaml, ["spec", "limits", "memory"]);
  const afterMem = scalarAtPath(modifiedYaml, ["spec", "limits", "memory"]);
  if (beforeMem && afterMem && parseMemBytes(afterMem) < parseMemBytes(beforeMem)) {
    findings.push({
      kind: "limits-shrunk-memory",
      message: `spec.limits.memory is shrinking (${beforeMem} → ${afterMem}) — pods may become unschedulable once existing nodes are replaced.`,
    });
  }

  const beforeBudgets = budgetNodesValues(originalYaml);
  const afterBudgets = budgetNodesValues(modifiedYaml);
  const pairCount = Math.min(beforeBudgets.length, afterBudgets.length);
  for (const [i, before] of beforeBudgets.slice(0, pairCount).entries()) {
    const after = afterBudgets[i];
    if (after !== undefined && isLower(before, after)) {
      findings.push({
        kind: "budget-nodes-lowered",
        message: `Disruption budget #${i + 1}'s nodes limit is being lowered (${before} → ${after}).`,
      });
      break;
    }
  }

  const beforePolicy = scalarAtPath(originalYaml, ["spec", "disruption", "consolidationPolicy"]);
  const afterPolicy = scalarAtPath(modifiedYaml, ["spec", "disruption", "consolidationPolicy"]);
  if (afterPolicy === "WhenEmptyOrUnderutilized" && beforePolicy !== afterPolicy) {
    findings.push({
      kind: "consolidation-policy-to-when-empty-or-underutilized",
      message: `consolidationPolicy is switching to WhenEmptyOrUnderutilized — Karpenter may now actively evict pods off underutilized (not just empty) nodes.`,
    });
  }

  return findings;
}
