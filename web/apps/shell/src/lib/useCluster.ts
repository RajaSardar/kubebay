import { useQuery } from "@tanstack/react-query";
import { useActiveCluster } from "../App";
import { api } from "./api";

export function useCluster() {
  const { active, setActive } = useActiveCluster();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const list = clusters.data ?? [];
  const usable = list.filter((c) => c.status !== "misconfigured");
  const cluster = active || usable.find((c) => c.status === "connected")?.id || usable[0]?.id || "";
  return { cluster, setCluster: setActive, list, isLoading: clusters.isLoading };
}
