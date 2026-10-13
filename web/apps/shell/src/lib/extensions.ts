/**
 * KB-13: the columns and row actions declared in ~/.kubebay/extensions.yaml.
 * The engine validates the file; this fills in the templates. A URL action's
 * values are percent-encoded and can't change its host. A command action's
 * values are each quoted as one shell argument, and it's typed into the local
 * shell for the user to read and run, never run by Kubebay.
 */

import type { ExtAction, ExtColumn, ExtensionsFile } from "./api";

/** A table's resource, as ResourceDef has it. */
export interface ResourceRef {
  resource: string;
  group: string;
}

/** `pods` matches pods in any group; `deployments.apps` only that group's. */
export function appliesTo(selector: string, def: ResourceRef): boolean {
  const dot = selector.indexOf(".");
  if (dot < 0) return selector === def.resource;
  return selector.slice(0, dot) === def.resource && selector.slice(dot + 1) === def.group;
}

/** Whether an action's `contexts` (with * wildcards) allow this context. */
export function contextMatches(patterns: readonly string[] | undefined, context: string): boolean {
  if (!patterns?.length) return true;
  return patterns.some((p) => {
    const re = new RegExp(`^${p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    return re.test(context);
  });
}

export interface TemplateVars {
  name: string;
  namespace: string;
  kind: string;
  context: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
  }
  return out;
}

/** The values a template can use, from a raw Kubernetes object. */
export function varsOf(obj: unknown, kind: string, context: string): TemplateVars {
  const meta = ((obj as { metadata?: unknown } | null)?.metadata ?? {}) as Record<string, unknown>;
  return {
    name: typeof meta.name === "string" ? meta.name : "",
    namespace: typeof meta.namespace === "string" ? meta.namespace : "",
    kind,
    context,
    labels: stringMap(meta.labels),
    annotations: stringMap(meta.annotations),
  };
}

/**
 * One shell argument, for POSIX shells and fish alike: single quotes, with each
 * ' and \ written outside them (fish treats \' and \\ inside single quotes as
 * escapes; POSIX shells don't).
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/[\\']/g, (c) => (c === "'" ? "'\\''" : "'\\\\'"))}'`;
}

export type Expanded = { ok: true; value: string } | { ok: false; reason: string };

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
// C0 and C1 controls and DEL: a newline would run the line, an escape could end
// a bracketed paste. Bidi controls would make the command read differently
// from what it does.
// eslint-disable-next-line no-control-regex
const UNTYPEABLE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;

function lookup(ph: string, v: TemplateVars): { value?: string; what: string } {
  if (ph === "name" || ph === "namespace" || ph === "kind") return { value: v[ph] || undefined, what: ph };
  if (ph === "context") return { value: v.context || undefined, what: "context name" };
  const colon = ph.indexOf(":");
  const kind = ph.slice(0, colon);
  const key = ph.slice(colon + 1);
  if (colon > 0 && key && (kind === "label" || kind === "annotation")) {
    const m = kind === "label" ? v.labels : v.annotations;
    return { value: Object.prototype.hasOwnProperty.call(m, key) ? m[key] : undefined, what: `${kind} ${key}` };
  }
  return { what: `{{${ph}}}` };
}

function expand(tpl: string, v: TemplateVars, encode: (s: string, what: string) => Expanded): Expanded {
  let out = "";
  let last = 0;
  for (const m of tpl.matchAll(PLACEHOLDER)) {
    const ph = m[1] ?? "";
    const { value, what } = lookup(ph, v);
    if (what.startsWith("{{")) return { ok: false, reason: `Kubebay doesn't know the placeholder ${what}.` };
    if (value === undefined) return { ok: false, reason: `It has no ${what}.` };
    const enc = encode(value, what);
    if (!enc.ok) return enc;
    out += tpl.slice(last, m.index) + enc.value;
    last = (m.index ?? 0) + m[0].length;
  }
  return { ok: true, value: out + tpl.slice(last) };
}

/** A command action's line, ready to type into the local shell. */
export function expandRun(tpl: string, v: TemplateVars): Expanded {
  if (UNTYPEABLE.test(tpl)) return { ok: false, reason: "The command template has a control character." };
  return expand(tpl, v, (value, what) =>
    UNTYPEABLE.test(value)
      ? { ok: false, reason: `The ${what} has a control or direction character, so Kubebay won't type it into a shell.` }
      : { ok: true, value: shellQuote(value) },
  );
}

const SCHEME = /^https?:\/\//i;

/** A URL action's link. The scheme and host must be written out in the template. */
export function expandURL(tpl: string, v: TemplateVars): Expanded {
  const scheme = SCHEME.exec(tpl);
  if (!scheme) return { ok: false, reason: "The link must start with http:// or https://." };
  const rest = tpl.slice(scheme[0].length);
  const end = rest.search(/[/?#]/);
  const host = end < 0 ? rest : rest.slice(0, end);
  if (!host || host.includes("{{")) return { ok: false, reason: "The link's host must be written out in the template." };
  return expand(tpl, v, (value) => ({ ok: true, value: encodeURIComponent(value) }));
}

/** The extension columns for a table's resource. */
export function columnsFor(file: ExtensionsFile | undefined, def: ResourceRef): ExtColumn[] {
  return file?.columns.filter((c) => appliesTo(c.resource, def)) ?? [];
}

/**
 * The row actions for a table's resource in this context. Command actions are
 * left out where there's no local shell to type them into.
 */
export function actionsFor(file: ExtensionsFile | undefined, def: ResourceRef, context: string): ExtAction[] {
  if (!file) return [];
  return file.actions.filter(
    (a) => appliesTo(a.resource, def) && contextMatches(a.contexts, context) && (a.url !== undefined || file.commands.available),
  );
}

/**
 * Types a command into a new shell once its first output (the prompt) has
 * gone quiet, so it lands at the prompt rather than in the shell's startup.
 * Never sends Enter: the user reads it and runs it.
 */
export function typeWhenQuiet(
  text: string,
  paste: (text: string) => void,
  { quietMs = 300, maxMs = 3000 }: { quietMs?: number; maxMs?: number } = {},
): { onData: () => void; cancel: () => void } {
  let done = false;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let max: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    if (done) return;
    done = true;
    clearTimeout(quiet);
    clearTimeout(max);
    paste(text);
  };
  return {
    onData: () => {
      if (done) return;
      clearTimeout(quiet);
      quiet = setTimeout(fire, quietMs);
      max ??= setTimeout(fire, maxMs);
    },
    cancel: () => {
      done = true;
      clearTimeout(quiet);
      clearTimeout(max);
    },
  };
}
