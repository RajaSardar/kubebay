import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { LocalShellTerm } from "../components/LocalShellTerm";
import { useActiveCluster } from "../App";
import { api } from "../lib/api";
import type { ShellPrefill } from "../lib/useExtensions";
import { EmptyState, Stack } from "@kubebay/ui";

/** A command action's line from the route state (KB-13), if that's what it holds. */
function prefillOf(state: unknown): ShellPrefill | undefined {
  const p = (state as { prefill?: Partial<ShellPrefill> } | null)?.prefill;
  return p && typeof p.cluster === "string" && typeof p.command === "string" && typeof p.label === "string"
    ? { cluster: p.cluster, command: p.command, label: p.label }
    : undefined;
}

export default function TerminalPage() {
  const { active } = useActiveCluster();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const location = useLocation();
  const navigate = useNavigate();
  const prefill = prefillOf(location.state);

  // The shell takes the command when it opens. Drop it from history so going
  // back to this page, or reloading it, doesn't type it again.
  useEffect(() => {
    if (prefill) navigate(location.pathname, { replace: true, state: null });
  }, [prefill, navigate, location.pathname]);

  const cluster = prefill?.cluster || active;
  if (!cluster) {
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
    <Stack className="page" style={{ padding: 0, height: "100%" }}>
      <LocalShellTerm selectedCluster={cluster} clusters={clusters.data ?? []} prefill={prefill} />
    </Stack>
  );
}
