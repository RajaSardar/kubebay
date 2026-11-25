import type { PromMatrix } from "./api";

/**
 * The CPU and memory queries for one pod's graphs, most specific first. cAdvisor
 * labels differ between clusters: current ones use pod/container, older ones
 * pod_name/container_name, and some runtimes leave container empty, so each graph
 * tries them in turn and keeps the first that returns series. An `image!=""` filter
 * is not used: `container!=""` already drops the pod's cgroup parent series, and the
 * image label is empty for some runtimes.
 */
export function podCpuQueries(ns: string, pod: string): string[] {
  return [
    `sum by (container) (rate(container_cpu_usage_seconds_total{namespace="${ns}",pod="${pod}",container!="",container!="POD"}[5m]))`,
    legacy(`rate(container_cpu_usage_seconds_total{namespace="${ns}",pod_name="${pod}",container_name!="",container_name!="POD"}[5m])`),
    `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="${ns}",pod="${pod}"}[5m]))`,
  ];
}

export function podMemQueries(ns: string, pod: string): string[] {
  return [
    `sum by (container) (container_memory_working_set_bytes{namespace="${ns}",pod="${pod}",container!="",container!="POD"})`,
    legacy(`container_memory_working_set_bytes{namespace="${ns}",pod_name="${pod}",container_name!="",container_name!="POD"}`),
    `sum by (pod) (container_memory_working_set_bytes{namespace="${ns}",pod="${pod}"})`,
  ];
}

function legacy(expr: string): string {
  return `sum by (container) (label_replace(${expr}, "container", "$1", "container_name", "(.+)"))`;
}

/** Runs the queries in order and returns the first answer with series; the last (empty) answer otherwise. */
export async function firstWithSeries(queries: string[], run: (query: string) => Promise<PromMatrix>): Promise<PromMatrix> {
  let last: PromMatrix = { data: { result: [] } };
  for (const q of queries) {
    last = await run(q);
    if (last.data.result.length > 0) return last;
  }
  return last;
}
