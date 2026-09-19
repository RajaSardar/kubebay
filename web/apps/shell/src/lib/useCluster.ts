import { useQuery } from "@tanstack/react-query";
import { useActiveCluster } from "../App";
import { api } from "./api";

export function useCluster() {
  const { active, setActive } = useActiveCluster();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const list = clusters.data ?? [];
  // Never fall back to list[0] or the first connected cluster — that produces an
  // unstable value that changes whenever the clusters query refetches (every 4 s),
  // which changes specKey in useResourceStream, tears down the stream, clears the
  // row store, and makes pod/workload content vanish. Use only the explicitly
  // selected cluster. If empty, pages redirect to /clusters.
  return { cluster: active, setCluster: setActive, list, isLoading: clusters.isLoading };
}
