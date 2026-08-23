import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card } from "@kubebay/ui";
import { api } from "../lib/api";

export default function Ports() {
  const qc = useQueryClient();
  const forwards = useQuery({ queryKey: ["pf"], queryFn: api.pfList, refetchInterval: 5000 });
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const list = clusters.data ?? [];
  const firstConnected = list.find((c) => c.status === "connected")?.id ?? "";

  const [cluster, setCluster] = useState(firstConnected);
  const [ns, setNs] = useState("default");
  const [pod, setPod] = useState("");
  const [podPort, setPodPort] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const effectiveCluster = cluster || firstConnected;

  async function create() {
    setErr("");
    setBusy(true);
    try {
      await api.pfStart({
        cluster: effectiveCluster,
        namespace: ns || "default",
        pod,
        podPort: Number(podPort),
        localPort: localPort ? Number(localPort) : 0,
      });
      setPod("");
      setPodPort("");
      setLocalPort("");
      await qc.invalidateQueries({ queryKey: ["pf"] });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function stop(id: string) {
    try {
      await api.pfStop(id);
      await qc.invalidateQueries({ queryKey: ["pf"] });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          Port forwards{" "}
          {!forwards.isLoading && (
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              · {(forwards.data ?? []).length}
            </span>
          )}
        </h2>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div className="pf-form">
          <select
            className="toolbar-select"
            value={effectiveCluster}
            onChange={(e) => setCluster(e.target.value)}
            aria-label="cluster"
          >
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
          <input className="toolbar-input" placeholder="namespace" value={ns} onChange={(e) => setNs(e.target.value)} spellCheck={false} />
          <input className="toolbar-input" placeholder="pod name" value={pod} onChange={(e) => setPod(e.target.value)} spellCheck={false} style={{ flex: 2 }} />
          <input className="toolbar-input" placeholder="pod port" value={podPort} onChange={(e) => setPodPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
          <input className="toolbar-input" placeholder="local (auto)" value={localPort} onChange={(e) => setLocalPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
          <Button disabled={busy || !effectiveCluster || !pod || !podPort} onClick={() => void create()}>
            Forward
          </Button>
        </div>
        {err && <div className="error-text small" style={{ marginTop: 8 }}>{err}</div>}
      </Card>

      {(forwards.data ?? []).length === 0 ? (
        <div className="empty-state">
          <p>No active tunnels.</p>
          <p className="muted small">Tunnels bind to 127.0.0.1 only and die with the engine.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr>
                <th>Local</th>
                <th>Target</th>
                <th>Cluster</th>
                <th>Started</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(forwards.data ?? []).map((f) => (
                <tr key={f.id}>
                  <td>
                    <a className="mono strong pf-link" href={`http://127.0.0.1:${f.localPort}`} target="_blank" rel="noreferrer">
                      127.0.0.1:{f.localPort}
                    </a>
                  </td>
                  <td className="mono muted">
                    {f.namespace}/{f.pod}:{f.podPort}
                  </td>
                  <td className="mono muted">{f.cluster}</td>
                  <td className="mono muted">
                    {new Date(f.startedAt).toLocaleTimeString()}
                  </td>
                  <td>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Button variant="danger" onClick={() => void stop(f.id)}>
                        Stop
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
