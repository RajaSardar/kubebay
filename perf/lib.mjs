// KB-02: the parts of the performance harness that don't touch a process or a cluster.

export function median(xs) {
  if (xs.length === 0) throw new Error("median of no samples");
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
