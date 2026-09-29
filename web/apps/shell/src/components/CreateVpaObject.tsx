import { useState } from "react";
import { ArmedButton, Badge } from "@kubebay/ui";
import { api } from "../lib/api";
import { buildVpaObjectYaml } from "../lib/vpa";

type State = "idle" | "busy" | "done" | "error";

/**
 * Closes the other half of the "installed the recommender but still shows
 * no data" bug: the recommender is a controller, not a data source on its
 * own — it only computes recommendations for VerticalPodAutoscaler *objects*
 * that already exist, and nothing in Kubebay created any. This creates one,
 * always updateMode "Off" (observe-only, never evicts/resizes a pod), for a
 * single workload.
 */
export function CreateVpaObject({ cluster, ns, kind, name }: { cluster: string; ns: string; kind: string; name: string }) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  async function create() {
    setState("busy");
    try {
      const yaml = buildVpaObjectYaml({ kind, ns, name });
      await api.createResource({ cluster, yaml, dryRun: false });
      setState("done");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setState("error");
    }
  }

  if (state === "done") return <Badge tone="ok">VPA created</Badge>;

  return (
    <div>
      <ArmedButton
        label="Create VPA (Off)"
        confirmLabel={`Create a VerticalPodAutoscaler for ${kind.toLowerCase()} "${name}"? It only observes — nothing evicts or resizes pods.`}
        variant="primary"
        busy={state === "busy"}
        onGo={() => void create()}
      />
      {state === "error" && <div className="error-text small" style={{ marginTop: 4 }}>{error}</div>}
    </div>
  );
}
