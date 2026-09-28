import { useQuery } from "@tanstack/react-query";
import { LocalShellTerm } from "../components/LocalShellTerm";
import { useActiveCluster } from "../App";
import { api } from "../lib/api";
import { EmptyState } from "@kubebay/ui";

export default function TerminalPage() {
  const { active } = useActiveCluster();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });

  if (!active) {
    return (
      <div className="page">
        <EmptyState>
          <p>No cluster selected.</p>
          <p className="muted small">Select a cluster to open a terminal.</p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page" style={{ padding: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      <LocalShellTerm selectedCluster={active} clusters={clusters.data ?? []} />
    </div>
  );
}
