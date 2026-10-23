#!/usr/bin/env node
// KB-02 steps 2–4: check a performance run (perf/harness.mjs's perf.json)
// against the budgets in perf/budgets.json (PRD §6).
//
//   node scripts/perf-budgets.mjs --results perf/perf.json --budgets perf/budgets.json \
//     [--summary "$GITHUB_STEP_SUMMARY"] [--fail]
//
// --fail makes a budget over an error and a failing exit (step 4). A budget
// marked warnOnly stays a warning until it has three stable runs on main.
// A budget has a max (memory, time) or a min (frame rate).

import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** A metric by dotted name; `watch.<pods>.<mode>.<field>` picks a watch entry. */
export function metric(results, key) {
  const parts = key.split(".");
  if (parts[0] === "watch") {
    const [, pods, mode, field] = parts;
    const w = (results.watch ?? []).find((x) => x.pods === Number(pods) && x.mode === mode);
    return w?.[field];
  }
  return parts.reduce((o, p) => (o == null ? undefined : o[p]), results);
}

/** A watch entry that synced fewer pods than it was meant to doesn't count. */
function shortWatch(results, key) {
  const [kind, pods, mode] = key.split(".");
  if (kind !== "watch") return null;
  const w = (results.watch ?? []).find((x) => x.pods === Number(pods) && x.mode === mode);
  return w && w.count !== w.pods ? `saw ${w.count} of ${w.pods} pods` : null;
}

export function evaluate(results, budgets) {
  return Object.entries(budgets).map(([key, b]) => {
    const short = shortWatch(results, key);
    const value = short ? undefined : metric(results, key);
    const outside = b.min != null ? value < b.min : value > b.max;
    const status = typeof value !== "number" ? "not measured" : outside ? "over" : "ok";
    return { key, ...b, value, status, note: short ?? "" };
  });
}

const fmt = (v, unit) => (typeof v === "number" ? `${v} ${unit}` : "–");
const limit = (r) => (r.min != null ? `≥ ${r.min} ${r.unit}` : `≤ ${r.max} ${r.unit}`);
const fails = (r) => r.status === "over" && !r.warnOnly;

export function annotations(rows, level = "warning") {
  return rows
    .filter((r) => r.status === "over")
    .map((r) => {
      const past = r.min != null ? `below its ${r.min}` : `over its ${r.max}`;
      return `::${r.warnOnly ? "warning" : level} title=Performance budget::${r.label} is ${fmt(r.value, r.unit)}, ${past} ${r.unit} budget (${r.source})`;
    });
}

export function summaryMarkdown(rows, results) {
  const out = [
    `### Performance (${results.date?.slice(0, 10) ?? "undated"}, ${results.commit ?? "unknown commit"})`,
    "",
    `Kubernetes ${results.kubernetes ?? "?"}. Method: docs/PERFORMANCE.md.`,
    "",
    "| Budget | Measured | Limit | Status |",
    "|---|---|---|---|",
    ...rows.map((r) => {
      const note = [r.status === "over" && r.warnOnly ? "warning only" : "", r.note].filter(Boolean).join("; ");
      return `| ${r.label} | ${fmt(r.value, r.unit)} | ${limit(r)} | ${r.status}${note ? ` (${note})` : ""} |`;
    }),
    "",
    "| Pods watched | Time to sync | Engine RSS |",
    "|---|---|---|",
    ...(results.watch ?? []).map((w) => `| ${w.pods} pods, ${w.mode} | ${w.syncMs} ms | ${w.rssMB} MB |`),
    "",
  ];
  return out.join("\n");
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const fail = argv.includes("--fail");
  const results = JSON.parse(readFileSync(arg("results") ?? "perf/perf.json", "utf8"));
  const budgets = JSON.parse(readFileSync(arg("budgets") ?? "perf/budgets.json", "utf8"));
  const rows = evaluate(results, budgets);
  const md = summaryMarkdown(rows, results);
  console.log(md);
  if (arg("summary")) appendFileSync(arg("summary"), md + "\n");
  for (const line of annotations(rows, fail ? "error" : "warning")) console.log(line);
  if (fail && rows.some(fails)) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
