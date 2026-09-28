import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, DataTable, EmptyState, PageHeader, Select, TextField } from "@kubebay/ui";
import { api } from "../lib/api";
import { useCluster } from "../lib/useCluster";

export default function Ports() {
  const qc = useQueryClient();
  const forwards = useQuery({ queryKey: ["pf"], queryFn: api.pfList, refetchInterval: 5000 });
  const { cluster: effectiveCluster, setCluster, list } = useCluster();
  const [ns, setNs] = useState("default");
  const [pod, setPod] = useState("");
  const [podPort, setPodPort] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

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
      <PageHeader level={2} title="Port forwards" count={!forwards.isLoading && `· ${(forwards.data ?? []).length}`} />

      <Card style={{ marginBottom: 16 }}>
        <div className="pf-form">
          <Select
            value={effectiveCluster}
            onChange={(e) => setCluster(e.target.value)}
            aria-label="cluster"
          >
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </Select>
          <TextField placeholder="namespace" value={ns} onChange={(e) => setNs(e.target.value)} spellCheck={false} />
          <TextField placeholder="pod name" value={pod} onChange={(e) => setPod(e.target.value)} spellCheck={false} style={{ flex: 2 }} />
          <TextField placeholder="pod port" value={podPort} onChange={(e) => setPodPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
          <TextField placeholder="local (auto)" value={localPort} onChange={(e) => setLocalPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
          <Button disabled={busy || !effectiveCluster || !pod || !podPort} onClick={() => void create()}>
            Forward
          </Button>
        </div>
        {err && <div className="error-text small" style={{ marginTop: 8 }}>{err}</div>}
      </Card>

      {(forwards.data ?? []).length === 0 ? (
        <EmptyState>
          <p>No active tunnels.</p>
          <p className="muted small">Tunnels bind to 127.0.0.1 only and die with the engine.</p>
        </EmptyState>
      ) : (
        <DataTable
          rows={forwards.data ?? []}
          rowKey={(f) => f.id}
          columns={[
            {
              key: "local",
              header: "Local",
              render: (f) => (
                <a className="mono strong pf-link" href={`http://127.0.0.1:${f.localPort}`} target="_blank" rel="noreferrer">
                  127.0.0.1:{f.localPort}
                </a>
              ),
            },
            { key: "target", header: "Target", className: "mono muted", render: (f) => `${f.namespace}/${f.pod}:${f.podPort}` },
            { key: "cluster", header: "Cluster", className: "mono muted", render: (f) => f.cluster },
            { key: "started", header: "Started", className: "mono muted", render: (f) => new Date(f.startedAt).toLocaleTimeString() },
            {
              key: "actions",
              header: "",
              render: (f) => (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button variant="danger" onClick={() => void stop(f.id)}>
                    Stop
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
