import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button } from "@kubebay/ui";
import { api } from "../lib/api";

const FIELDS = [
  { key: "cpuRequest", label: "CPU request", section: "requests", res: "cpu", ph: "100m" },
  { key: "memRequest", label: "Mem request", section: "requests", res: "memory", ph: "128Mi" },
  { key: "cpuLimit", label: "CPU limit", section: "limits", res: "cpu", ph: "500m" },
  { key: "memLimit", label: "Mem limit", section: "limits", res: "memory", ph: "256Mi" },
] as const;

export function ResizePanel({
  cluster,
  namespace,
  pod,
  containers,
}: {
  cluster: string;
  namespace: string;
  pod: string;
  containers: string[];
}) {
  const container = containers[0] ?? "";
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const live = useQuery({
    queryKey: ["resize-current", cluster, namespace, pod],
    queryFn: () => api.getYamlText(cluster, "v1/pods", namespace, pod),
    staleTime: 15_000,
    retry: 1,
    retryDelay: 2000,
    refetchOnWindowFocus: false,
    enabled: !!cluster && !!namespace && !!pod,
  });

  function current(section: string, res: string): string {
    try {
      const doc = JSON.parse(live.data ?? "{}") as {
        spec?: { containers?: { name: string; resources?: Record<string, Record<string, string>> }[] };
      };
      const c = doc.spec?.containers?.find((x) => x.name === container);
      return c?.resources?.[section]?.[res] ?? "";
    } catch {
      return "";
    }
  }

  async function apply() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const resources: { requests?: Record<string, string>; limits?: Record<string, string> } = {};
      for (const f of FIELDS) {
        const v = vals[f.key]?.trim();
        if (v) {
          resources[f.section] = { ...(resources[f.section] ?? {}), [f.res]: v };
        }
      }
      await api.resizePod({ cluster, ns: namespace, name: pod, container, resources });
      setMsg("Patched — in-place if the pod allows it, otherwise on restart.");
      await live.refetch();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (!container) return <div className="muted small" style={{ padding: 14 }}>No container selected.</div>;

  return (
    <div style={{ padding: 14 }}>
      <div className="rbac-section-title">Resize container "{container}"</div>
      {live.isLoading && <div className="muted small" style={{ marginBottom: 8 }}>Loading current resources…</div>}
      {live.isError && <div className="error-banner" style={{ marginBottom: 10 }}>Could not load current resources.</div>}
      <div className="pf-form" style={{ gridTemplateColumns: "repeat(2, minmax(160px, 1fr))", maxWidth: 520 }}>
        {FIELDS.map((f) => (
          <label key={f.key} className="ctl" style={{ flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
            <span className="muted small">{f.label} <span className="subtle">({current(f.section, f.res) || "unset"})</span></span>
            <input
              className="toolbar-input"
              style={{ width: "100%" }}
              placeholder={f.ph}
              value={vals[f.key] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              spellCheck={false}
            />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
        <Button disabled={busy || live.isLoading} onClick={() => void apply()}>
          {busy ? "Patching…" : "Apply resize"}
        </Button>
        {msg && <span className="small" style={{ color: "var(--kb-status-ok)" }}>{msg}</span>}
        {err && <span className="error-text small">{err}</span>}
        {!msg && !err && <Badge>K8s ≥1.33 in-place</Badge>}
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        Only filled fields are patched. Restart behaviour follows each container's <span className="mono">resizePolicy</span>.
      </p>
    </div>
  );
}
