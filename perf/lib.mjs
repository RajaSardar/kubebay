// KB-02: the parts of the performance harness that don't touch a process or a cluster.

export function median(xs) {
  if (xs.length === 0) throw new Error("median of no samples");
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The nearest-rank percentile: the smallest sample with at least p% of them at or below it. */
export function percentile(xs, p) {
  if (xs.length === 0) throw new Error("percentile of no samples");
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(1, Math.ceil((p / 100) * s.length)) - 1];
}

const round1 = (x) => Math.round(x * 10) / 10;

/** Frame rate and the p95 frame time from successive requestAnimationFrame timestamps (ms). */
export function frameStats(stamps) {
  if (stamps.length < 2) throw new Error("frame stats need at least two frames");
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
  const ms = stamps[stamps.length - 1] - stamps[0];
  return { frames: gaps.length, fps: round1(gaps.length / (ms / 1000)), p95FrameMs: round1(percentile(gaps, 95)) };
}

/** Resident set size, in MB, from the text of /proc/<pid>/status. */
export function rssMB(status) {
  const m = /^VmRSS:\s+(\d+) kB$/m.exec(status);
  if (!m) throw new Error("no VmRSS in /proc status");
  return Math.round((Number(m[1]) / 1024) * 10) / 10;
}

/** User plus system CPU time, in clock ticks, from the text of /proc/<pid>/stat. */
export function cpuTicks(stat) {
  // The name is in parentheses and may hold spaces and parentheses itself.
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  // utime and stime are fields 14 and 15 of the whole line: 12 and 13 after the name.
  return Number(fields[11]) + Number(fields[12]);
}

/**
 * `count` pods from index `start`, as a List for `kubectl create -f -`. They
 * name a scheduler that doesn't exist, so they stay Pending: no node, no image
 * pull, no scheduling events, just objects the engine has to watch.
 */
export function podsList(namespace, start, count) {
  const items = Array.from({ length: count }, (_, k) => {
    const i = start + k;
    const name = `perf-${String(i).padStart(5, "0")}`;
    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name,
        namespace,
        labels: { app: `perf-app-${i % 50}`, tier: i % 3 ? "backend" : "frontend", "kubebay.dev/perf": "true" },
        annotations: { "kubebay.dev/perf-index": String(i) },
      },
      spec: {
        schedulerName: "kubebay-perf-unscheduled",
        containers: [
          {
            name: "app",
            image: "registry.k8s.io/pause:3.10",
            ports: [{ containerPort: 8080, name: "http" }],
            env: [{ name: "PERF_INDEX", value: String(i) }],
            resources: { requests: { cpu: "10m", memory: "16Mi" }, limits: { memory: "32Mi" } },
          },
        ],
      },
    };
  });
  return { apiVersion: "v1", kind: "List", items };
}

/**
 * A kubeconfig (as `kubectl config view --raw --minify -o json` prints it)
 * with `context` under `n` names: `context`, `context-2`, … The engine treats
 * each name as its own cluster, though they all reach the same API server.
 */
export function aliasContexts(config, context, n) {
  const ctx = (config.contexts ?? []).find((c) => c.name === context);
  if (!ctx) throw new Error(`no context "${context}" in the kubeconfig`);
  const aliases = Array.from({ length: n - 1 }, (_, i) => ({ name: `${context}-${i + 2}`, context: { ...ctx.context } }));
  return { ...config, contexts: [ctx, ...aliases], "current-context": context };
}

/** podsList's pods as the API server lists them once created: uid, timestamps, Pending. */
export function listedPods(namespace, count, created) {
  return podsList(namespace, 0, count).items.map((p, i) => ({
    ...p,
    metadata: {
      ...p.metadata,
      uid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      creationTimestamp: created,
      resourceVersion: String(1000 + i),
    },
    status: { phase: "Pending", qosClass: "Burstable" },
  }));
}

/**
 * A subscription's snapshot as the engine frames it (engine/internal/stream/hub.go):
 * begin, then items of up to 200 adds. The sync control frame follows, as JSON.
 */
export function snapshotFrames(id, objects, perFrame = 200) {
  const frames = [{ type: "begin", id }];
  for (let i = 0; i < objects.length; i += perFrame) {
    const ops = objects.slice(i, i + perFrame).map((obj) => ({ op: "a", key: `${obj.metadata.namespace}/${obj.metadata.name}`, obj }));
    frames.push({ type: "items", id, ops });
  }
  return frames;
}
