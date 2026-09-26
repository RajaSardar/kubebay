import { useQuery } from "@tanstack/react-query";
import { LocalShellTerm } from "../components/LocalShellTerm";
import { useActiveCluster } from "../App";
import { api } from "../lib/api";

export default function TerminalPage() {
  const { active } = useActiveCluster();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });

  if (!active) {
    return (
      <div className="page">
        <div className="empty-state">
          <p>No cluster selected.</p>
          <p className="muted small">Select a cluster to open a terminal.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ padding: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      <LocalShellTerm selectedCluster={active} clusters={clusters.data ?? []} />
    </div>
  );
}
