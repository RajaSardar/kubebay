// KB-02 steps 2–4: the performance budgets. Run: node --test scripts/perf-budgets.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { annotations, evaluate, metric, summaryMarkdown } from "./perf-budgets.mjs";

const results = {
  date: "2026-10-14T02:00:00Z",
  commit: "abc1234",
  kubernetes: "v1.34.11",
  coldStart: { totalMs: 1620, engineReadyMs: 140, firstFrameMs: 1480 },
  idle: { rssMB: 61.2, cpuPercent: 0.1 },
  watch: [
    { pods: 1000, mode: "metadata", syncMs: 310, rssMB: 70.4, count: 1000 },
    { pods: 10000, mode: "metadata", syncMs: 2100, rssMB: 142.9, count: 10000 },
    { pods: 10000, mode: "full", syncMs: 2600, rssMB: 210.5, count: 10000 },
  ],
};

const budgets = {
  "coldStart.totalMs": { max: 1500, unit: "ms", label: "Cold start to first interactive frame", source: "PRD §6" },
  "idle.rssMB": { max: 150, unit: "MB", label: "Engine idle RSS", source: "PRD §6" },
  "watch.10000.metadata.rssMB": { max: 400, unit: "MB", label: "Engine RSS, 10k pods (metadata)", source: "PRD §6" },
  "watch.100000.metadata.rssMB": { max: 400, unit: "MB", label: "Engine RSS, 100k pods (metadata)", source: "PRD §6" },
};

test("reads a metric by its dotted name, watch entries by pod count and mode", () => {
  assert.equal(metric(results, "idle.rssMB"), 61.2);
  assert.equal(metric(results, "coldStart.totalMs"), 1620);
  assert.equal(metric(results, "watch.10000.full.rssMB"), 210.5);
  assert.equal(metric(results, "watch.100000.metadata.rssMB"), undefined);
  assert.equal(metric(results, "nope.rssMB"), undefined);
});

test("marks each budget ok, over, or not measured", () => {
  const rows = evaluate(results, budgets);
  assert.deepEqual(
    rows.map((r) => [r.key, r.status]),
    [
      ["coldStart.totalMs", "over"],
      ["idle.rssMB", "ok"],
      ["watch.10000.metadata.rssMB", "ok"],
      ["watch.100000.metadata.rssMB", "not measured"],
    ],
  );
  assert.equal(rows[0].value, 1620);
});

test("a watch that didn't see every pod isn't a measurement of that many", () => {
  const short = { ...results, watch: [{ pods: 10000, mode: "metadata", syncMs: 9000, rssMB: 90, count: 9100 }] };
  const [row] = evaluate(short, { "watch.10000.metadata.rssMB": budgets["watch.10000.metadata.rssMB"] });
  assert.equal(row.status, "not measured");
  assert.match(row.note, /9100 of 10000/);
});

test("warns on each budget over, and only those", () => {
  const lines = annotations(evaluate(results, budgets), "warning");
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    "::warning title=Performance budget::Cold start to first interactive frame is 1620 ms, over its 1500 ms budget (PRD §6)",
  );
  assert.match(annotations(evaluate(results, budgets), "error")[0], /^::error /);
});

test("writes a summary table with the run's date and commit", () => {
  const md = summaryMarkdown(evaluate(results, budgets), results);
  assert.match(md, /abc1234/);
  assert.match(md, /2026-10-14/);
  assert.match(md, /\| Cold start to first interactive frame \| 1620 ms \| ≤ 1500 ms \| over \|/);
  assert.match(md, /\| Engine RSS, 100k pods \(metadata\) \| – \| ≤ 400 MB \| not measured \|/);
  // Every watch measurement is listed, budgeted or not.
  assert.match(md, /10000 pods, full \| 2600 ms \| 210.5 MB/);
});

test("--fail exits non-zero when a budget is over, and zero when none is", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "perf-budgets-"));
  const run = (r) => {
    writeFileSync(join(dir, "perf.json"), JSON.stringify(r));
    writeFileSync(join(dir, "budgets.json"), JSON.stringify(budgets));
    return spawnSync(process.execPath, [new URL("./perf-budgets.mjs", import.meta.url).pathname, "--results", join(dir, "perf.json"), "--budgets", join(dir, "budgets.json"), "--fail"], { encoding: "utf8" });
  };
  const over = run(results); // cold start 1620 ms > 1500
  assert.equal(over.status, 1);
  assert.match(over.stdout, /::error /);
  // Within budget, and the unmeasured 100k row doesn't fail the build.
  const ok = run({ ...results, coldStart: { ...results.coldStart, totalMs: 900 } });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

// KB-02 step 4: main had three stable runs within budget (6f06324, e0c1d1f,
// 61f9c3d on 2026-10-14), so over budget now fails the perf job.
test("CI's Budgets step fails the build on a budget over", async () => {
  const { readFileSync } = await import("node:fs");
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const step = ci.split("\n").find((l) => l.includes("scripts/perf-budgets.mjs"));
  assert.ok(step, "ci.yml runs scripts/perf-budgets.mjs");
  assert.match(step, /--fail\b/);
});

// KB-02: frame rate has a floor, not a ceiling.
test("a budget with a minimum is over when the measurement falls below it", () => {
  const fps = { "scroll.fps": { min: 55, unit: "fps", label: "Scrolling a 100k-row table", source: "PRD §6" } };
  const [slow] = evaluate({ ...results, scroll: { fps: 48.2 } }, fps);
  assert.equal(slow.status, "over");
  assert.equal(
    annotations([slow], "warning")[0],
    "::warning title=Performance budget::Scrolling a 100k-row table is 48.2 fps, below its 55 fps budget (PRD §6)",
  );
  assert.match(summaryMarkdown([slow], results), /\| Scrolling a 100k-row table \| 48.2 fps \| ≥ 55 fps \| over \|/);
  assert.equal(evaluate({ ...results, scroll: { fps: 59.9 } }, fps)[0].status, "ok");
});

// A new budget warns until it has three stable runs on main, as the first
// four did (KB-02 step 4); then its warnOnly comes out.
test("a warn-only budget over its limit warns, even under --fail, and doesn't fail the build", async () => {
  const paint = { "paint.p95Ms": { max: 100, unit: "ms", label: "Watch event to painted row, p95", source: "PRD §6", warnOnly: true } };
  const rows = evaluate({ ...results, paint: { p95Ms: 140 } }, paint);
  assert.equal(rows[0].status, "over");
  assert.match(annotations(rows, "error")[0], /^::warning /);
  assert.match(summaryMarkdown(rows, results), /\| 140 ms \| ≤ 100 ms \| over \(warning only\) \|/);

  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "perf-budgets-"));
  writeFileSync(join(dir, "perf.json"), JSON.stringify({ ...results, coldStart: { totalMs: 900 }, paint: { p95Ms: 140 } }));
  writeFileSync(join(dir, "budgets.json"), JSON.stringify({ ...budgets, ...paint }));
  const run = spawnSync(process.execPath, [new URL("./perf-budgets.mjs", import.meta.url).pathname, "--results", join(dir, "perf.json"), "--budgets", join(dir, "budgets.json"), "--fail"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /::warning title=Performance budget::Watch event to painted row/);
});

// Three of them had three stable runs on main with room to spare (f578e2b,
// 76ccd3c, 2e17488 on 2026-10-27/28), so they fail the build now. Scrolling
// measured 57.4 to 60 fps against its floor of 55: too close for runner noise
// not to fail a build, so it still warns.
test("the budgets the harness gained later are the PRD's; all but scrolling fail the build", async () => {
  const { readFileSync } = await import("node:fs");
  const file = JSON.parse(readFileSync(new URL("../perf/budgets.json", import.meta.url), "utf8"));
  const limit = (k) => file[k].max ?? file[k].min;
  assert.deepEqual(
    ["paint.p95Ms", "scroll.fps", "idle3.rssMB", "idle3.cpuPercent"].map((k) => [k, limit(k), file[k].warnOnly]),
    [
      ["paint.p95Ms", 100, undefined],
      ["scroll.fps", 55, true],
      ["idle3.rssMB", 250, undefined],
      ["idle3.cpuPercent", 1, undefined],
    ],
  );
  assert.equal(file["scroll.fps"].min, 55);
  // The first four fail the build.
  for (const k of ["coldStart.totalMs", "idle.rssMB", "idle.cpuPercent", "watch.10000.metadata.rssMB"]) assert.equal(file[k].warnOnly, undefined, k);
});
