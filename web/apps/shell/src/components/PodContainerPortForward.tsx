import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@kubebay/ui";
import { api } from "../lib/api";

// A click-to-forward affordance on a container's port row: reuses the
// engine's existing port-forward manager (the same one the standalone
// Ports page drives) rather than introducing any new capability, so
// starting a tunnel from here is exactly as trusted and audited as
// starting one there. Sharing the "pf" query key means both surfaces
// poll the same cache instead of doubling the request rate.
export function PodContainerPortForward({
  cluster,
  namespace,
  pod,
  podPort,
}: {
  cluster: string;
  namespace: string;
  pod: string;
  podPort: number;
}) {
  const qc = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const { data: forwards = [] } = useQuery({ queryKey: ["pf"], queryFn: api.pfList, refetchInterval: 5000 });
  const active = forwards.find((f) => f.cluster === cluster && f.namespace === namespace && f.pod === pod && f.podPort === podPort);

  async function start() {
    setError("");
    setStarting(true);
    try {
      const fw = await api.pfStart({ cluster, namespace, pod, podPort });
      await qc.invalidateQueries({ queryKey: ["pf"] });
      window.open(`http://127.0.0.1:${fw.localPort}`, "_blank", "noreferrer");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    if (!active) return;
    setError("");
    try {
      await api.pfStop(active.id);
      await qc.invalidateQueries({ queryKey: ["pf"] });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  if (active) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <a className="mono small pf-link" href={`http://127.0.0.1:${active.localPort}`} target="_blank" rel="noreferrer">
          127.0.0.1:{active.localPort}
        </a>
        <Button variant="danger" onClick={() => void stop()}>
          Stop
        </Button>
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Button variant="ghost" disabled={starting} onClick={() => void start()}>
        {starting ? "Forwarding…" : "Forward"}
      </Button>
      {error && <span className="error-text small">{error}</span>}
    </span>
  );
}
