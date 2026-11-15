/**
 * The resource-table filter language (docs/TABLE_FOLLOWUPS.md, #25):
 *   plain words      match any shown text; every word must match
 *   ns:shop          a field: ns, name, or a column's filterKey (status:, node:, …)
 *   label:app=web    a label with that exact value; label:app means the label exists (l: too)
 *   -word, -key:val  negation
 * A `key:value` whose key the table does not know stays plain text, so a
 * name such as "system:node" still matches as written. Matching ignores case
 * except label keys and values, which Kubernetes compares exactly.
 */

export interface QueryRow {
  /** Everything the row shows, for plain words. */
  text: readonly string[];
  /** Named fields for `key:value` tokens (ns, name, and column keys). */
  fields: Readonly<Record<string, string>>;
  labels?: Readonly<Record<string, string>>;
}

export interface QueryToken {
  key: string;
  value: string;
  neg: boolean;
}

export interface Query {
  terms: { text: string; neg: boolean }[];
  tokens: QueryToken[];
}

const BUILT_IN = ["ns", "name", "label"];
const ALIASES: Record<string, string> = { l: "label", namespace: "ns" };

/** Splits a query into plain terms and the `key:value` tokens this table knows. */
export function parseQuery(q: string, columnKeys: readonly string[] = []): Query {
  const known = new Set([...BUILT_IN, ...columnKeys.map((k) => k.toLowerCase())]);
  const out: Query = { terms: [], tokens: [] };
  for (const raw of q.trim().split(/\s+/)) {
    if (!raw) continue;
    const neg = raw.startsWith("-") && raw.length > 1;
    const word = neg ? raw.slice(1) : raw;
    if (word === "-") continue;
    const colon = word.indexOf(":");
    if (colon > 0) {
      const typed = word.slice(0, colon).toLowerCase();
      const key = ALIASES[typed] ?? typed;
      if (known.has(key)) {
        const value = word.slice(colon + 1);
        // A key still being typed ("status:") filters nothing yet.
        if (value) out.tokens.push({ key, value, neg });
        continue;
      }
    }
    out.terms.push({ text: word, neg });
  }
  return out;
}

function tokenMatches(row: QueryRow, t: QueryToken): boolean {
  if (t.key === "label") {
    const labels = row.labels ?? {};
    const eq = t.value.indexOf("=");
    if (eq < 0) return Object.prototype.hasOwnProperty.call(labels, t.value);
    return labels[t.value.slice(0, eq)] === t.value.slice(eq + 1);
  }
  const field = row.fields[t.key];
  return field !== undefined && field.toLowerCase().includes(t.value.toLowerCase());
}

/** Whether a row satisfies every term and token of a parsed query. */
export function matchesQuery(row: QueryRow, q: Query): boolean {
  for (const term of q.terms) {
    const needle = term.text.toLowerCase();
    const hit = row.text.some((f) => f.toLowerCase().includes(needle));
    if (hit === term.neg) return false;
  }
  for (const t of q.tokens) {
    if (tokenMatches(row, t) === t.neg) return false;
  }
  return true;
}
