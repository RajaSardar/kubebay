// KB-02: the harness's pure parts. Run: node --test perf/lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpuTicks, median, podsList, rssMB } from "./lib.mjs";

test("median of an odd and an even count", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.throws(() => median([]), /no samples/);
});

test("reads resident memory from /proc/<pid>/status in MB", () => {
  const status = "Name:\tkubebay\nVmPeak:\t 900000 kB\nVmRSS:\t   65536 kB\nRssAnon:\t 40000 kB\n";
  assert.equal(rssMB(status), 64);
  assert.throws(() => rssMB("Name:\tzombie\n"), /VmRSS/);
});

test("reads CPU time from /proc/<pid>/stat, even with spaces and parens in the name", () => {
  // Fields after the name: state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime …
  const stat = "4242 (kube bay (x)) S 1 4242 4242 0 -1 4194560 100 0 0 0 731 269 0 0 20 0 12 0";
  assert.equal(cpuTicks(stat), 1000);
});

test("generates pods no scheduler will take, so they cost the cluster nothing to run", () => {
  const list = podsList("kubebay-perf", 10, 3);
  assert.equal(list.kind, "List");
  assert.deepEqual(list.items.map((p) => p.metadata.name), ["perf-00010", "perf-00011", "perf-00012"]);
  for (const p of list.items) {
    assert.equal(p.metadata.namespace, "kubebay-perf");
    assert.equal(p.spec.schedulerName, "kubebay-perf-unscheduled");
    assert.ok(p.metadata.labels.app);
    assert.ok(p.spec.containers[0].resources.requests.cpu);
  }
});
