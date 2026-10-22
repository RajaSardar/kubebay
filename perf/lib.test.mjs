// KB-02: the harness's pure parts. Run: node --test perf/lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { aliasContexts, cpuTicks, frameStats, listedPods, median, percentile, podsList, rssMB, snapshotFrames } from "./lib.mjs";

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

test("a percentile is the nearest-rank sample, so a p95 of 30 is the 29th fastest", () => {
  const xs = Array.from({ length: 30 }, (_, i) => 30 - i); // 30 … 1, unsorted on purpose
  assert.equal(percentile(xs, 95), 29);
  assert.equal(percentile(xs, 50), 15);
  assert.equal(percentile([7], 95), 7);
  assert.throws(() => percentile([], 95), /no samples/);
});

test("frame rate and frame time from requestAnimationFrame timestamps", () => {
  // 61 frames 1000/60 ms apart: one second at 60 fps.
  const smooth = Array.from({ length: 61 }, (_, i) => (i * 1000) / 60);
  assert.deepEqual(frameStats(smooth), { frames: 60, fps: 60, p95FrameMs: 16.7 });
  // One 68 ms frame among 16 ms ones: 4 frames in 116 ms.
  assert.deepEqual(frameStats([0, 16, 32, 100, 116]), { frames: 4, fps: 34.5, p95FrameMs: 68 });
  assert.throws(() => frameStats([5]), /two frames/);
});

test("aliases one kubeconfig context under several names, all the same cluster and user", () => {
  const config = {
    apiVersion: "v1",
    kind: "Config",
    clusters: [{ name: "kind-perf", cluster: { server: "https://127.0.0.1:6443" } }],
    users: [{ name: "kind-perf", user: { token: "t" } }],
    contexts: [{ name: "kind-perf", context: { cluster: "kind-perf", user: "kind-perf" } }],
    "current-context": "kind-perf",
  };
  const out = aliasContexts(config, "kind-perf", 3);
  assert.deepEqual(out.contexts.map((c) => c.name), ["kind-perf", "kind-perf-2", "kind-perf-3"]);
  for (const c of out.contexts) assert.deepEqual(c.context, { cluster: "kind-perf", user: "kind-perf" });
  assert.deepEqual(out.clusters, config.clusters);
  assert.deepEqual(out.users, config.users);
  assert.equal(out["current-context"], "kind-perf");
  assert.throws(() => aliasContexts(config, "nope", 3), /no context "nope"/);
});

test("lists pods the way the API server would return the generated ones", () => {
  const pods = listedPods("kubebay-perf", 3, "2026-10-22T00:00:00Z");
  assert.deepEqual(pods.map((p) => p.metadata.name), ["perf-00000", "perf-00001", "perf-00002"]);
  for (const p of pods) {
    assert.ok(p.metadata.uid);
    assert.equal(p.metadata.creationTimestamp, "2026-10-22T00:00:00Z");
    assert.ok(p.metadata.resourceVersion);
    assert.equal(p.status.phase, "Pending");
  }
  assert.notEqual(pods[0].metadata.uid, pods[1].metadata.uid);
});

test("a snapshot is a begin frame, then items 200 to a frame, as the engine sends it", () => {
  const pods = listedPods("kubebay-perf", 450, "2026-10-22T00:00:00Z");
  const frames = snapshotFrames("sub-1", pods);
  assert.deepEqual(frames.map((f) => [f.type, f.ops?.length ?? 0]), [["begin", 0], ["items", 200], ["items", 200], ["items", 50]]);
  for (const f of frames) assert.equal(f.id, "sub-1");
  assert.deepEqual(frames[1].ops[0], { op: "a", key: "kubebay-perf/perf-00000", obj: pods[0] });
});
