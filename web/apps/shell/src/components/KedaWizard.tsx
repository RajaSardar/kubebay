import { useMemo, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Badge, Button, Select, TextField } from "@kubebay/ui";
import { api } from "../lib/api";
import { useMonacoTheme } from "../lib/theme";
import { buildScaledObjectYaml, validateKedaWizardInput, type KedaTrigger, type KedaWizardInput } from "../lib/kedaWizard";
import { findCandidatePrometheusServices } from "../lib/prometheusServiceDiscovery";
import { PolicyRejectionError, type PolicyRejectionDetail } from "../lib/policyRejection";
import { PolicyRejectionCard } from "./PolicyRejectionCard";

/**
 * Backlog #2 P3: cron + CPU/memory wizard. Generates a ScaledObject from a
 * short form, previews it with the same DiffEditor YamlTab uses (against an
 * empty "original" since this always creates a new object), then dry-runs
 * and applies via the existing /api/yaml/create path (the same one
 * pages/CreateResource.tsx uses for any brand-new resource).
 */
export function KedaWizard({
  cluster,
  ns,
  targetKind,
  targetName,
  hpas,
  services = [],
  onApplied,
}: {
  cluster: string;
  ns: string;
  targetKind: "Deployment" | "StatefulSet";
  targetName: string;
  hpas: Record<string, unknown>[];
  /** Already-open Services stream, used only to suggest in-cluster Prometheus candidates. */
  services?: Record<string, unknown>[];
  onApplied?: () => void;
}) {
  const monacoTheme = useMonacoTheme();
  const [scaledObjectName, setScaledObjectName] = useState(`${targetName}-scale`);
  const [minReplicaCount, setMinReplicaCount] = useState(1);
  const [maxReplicaCount, setMaxReplicaCount] = useState(10);
  const [triggerType, setTriggerType] = useState<KedaTrigger["type"]>("cpu");
  const [averageUtilization, setAverageUtilization] = useState(70);
  const [cronStart, setCronStart] = useState("");
  const [cronEnd, setCronEnd] = useState("");
  const [cronTimezone, setCronTimezone] = useState("UTC");
  const [cronDesiredReplicas, setCronDesiredReplicas] = useState(1);
  const [promServerAddress, setPromServerAddress] = useState("");
  const [promQuery, setPromQuery] = useState("");
  const [promThreshold, setPromThreshold] = useState(100);
  const [zeroConfirm, setZeroConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejection, setRejection] = useState<PolicyRejectionDetail | null>(null);

  const promCandidates = useMemo(() => findCandidatePrometheusServices(services), [services]);

  const trigger: KedaTrigger = useMemo(() => {
    if (triggerType === "cron") {
      return { type: "cron", start: cronStart, end: cronEnd, timezone: cronTimezone, desiredReplicas: cronDesiredReplicas };
    }
    if (triggerType === "prometheus") {
      return { type: "prometheus", serverAddress: promServerAddress, query: promQuery, threshold: promThreshold };
    }
    return { type: triggerType, averageUtilization };
  }, [triggerType, cronStart, cronEnd, cronTimezone, cronDesiredReplicas, averageUtilization, promServerAddress, promQuery, promThreshold]);

  const input: KedaWizardInput = useMemo(
    () => ({ namespace: ns, targetKind, targetName, scaledObjectName, minReplicaCount, maxReplicaCount, trigger }),
    [ns, targetKind, targetName, scaledObjectName, minReplicaCount, maxReplicaCount, trigger],
  );

  const errors = useMemo(() => validateKedaWizardInput(input, hpas), [input, hpas]);
  const yaml = useMemo(() => buildScaledObjectYaml(input), [input]);
  const needsZeroConfirm = minReplicaCount === 0 && zeroConfirm.trim() !== targetName;
  const blocked = errors.length > 0;

  async function apply(dryRun: boolean) {
    setBusy(true);
    setMsg(null);
    setRejection(null);
    try {
      const r = await api.createResource({ cluster, yaml, dryRun });
      const dryRunText =
        trigger.type === "prometheus"
          ? "Dry-run passed — server accepted the manifest shape. This does not confirm the query is valid or that serverAddress is reachable from inside the cluster."
          : "Dry-run passed — server accepted the change.";
      setMsg({ ok: true, text: dryRun ? dryRunText : `Applied — ScaledObject "${scaledObjectName}" created (paused).` });
      if (!dryRun) onApplied?.();
      void r;
    } catch (e) {
      if (e instanceof PolicyRejectionError) {
        setRejection(e.rejection);
      } else {
        setMsg({ ok: false, text: String(e instanceof Error ? e.message : e) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          ScaledObject name
          <TextField value={scaledObjectName} onChange={(e) => setScaledObjectName(e.target.value)} spellCheck={false} />
        </label>
        <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          Min replicas
          <TextField
            style={{ maxWidth: 80 }}
            type="number"
            min={0}
            value={minReplicaCount}
            onChange={(e) => setMinReplicaCount(Number(e.target.value))}
          />
        </label>
        <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          Max replicas
          <TextField
            style={{ maxWidth: 80 }}
            type="number"
            min={0}
            value={maxReplicaCount}
            onChange={(e) => setMaxReplicaCount(Number(e.target.value))}
          />
        </label>
        <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          Trigger
          <Select value={triggerType} onChange={(e) => setTriggerType(e.target.value as KedaTrigger["type"])}>
            <option value="cpu">CPU utilization</option>
            <option value="memory">Memory utilization</option>
            <option value="cron">Cron schedule</option>
            <option value="prometheus">Prometheus query</option>
          </Select>
        </label>
      </div>

      {triggerType === "cron" && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
            Start (cron)
            <TextField placeholder="0 9 * * 1-5" value={cronStart} onChange={(e) => setCronStart(e.target.value)} spellCheck={false} />
          </label>
          <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
            End (cron)
            <TextField placeholder="0 18 * * 1-5" value={cronEnd} onChange={(e) => setCronEnd(e.target.value)} spellCheck={false} />
          </label>
          <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
            Timezone
            <TextField value={cronTimezone} onChange={(e) => setCronTimezone(e.target.value)} spellCheck={false} />
          </label>
          <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
            Desired replicas
            <TextField
              style={{ maxWidth: 80 }}
              type="number"
              min={0}
              value={cronDesiredReplicas}
              onChange={(e) => setCronDesiredReplicas(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      {(triggerType === "cpu" || triggerType === "memory") && (
        <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          Target utilization (%)
          <TextField
            style={{ maxWidth: 100 }}
            type="number"
            min={1}
            value={averageUtilization}
            onChange={(e) => setAverageUtilization(Number(e.target.value))}
          />
        </label>
      )}

      {triggerType === "prometheus" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="muted small">
            KEDA resolves this address in-cluster — it is never the same as Kubebay's local Prometheus proxy (usually a laptop
            port-forward), so nothing here is prefilled from Settings.
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              Server address (in-cluster)
              <TextField
                style={{ minWidth: 260 }}
                placeholder="http://prometheus-server.monitoring.svc:9090"
                value={promServerAddress}
                onChange={(e) => setPromServerAddress(e.target.value)}
                spellCheck={false}
                list="keda-wizard-prom-candidates"
              />
              {promCandidates.length > 0 && (
                <datalist id="keda-wizard-prom-candidates">
                  {promCandidates.map((c) => (
                    <option key={`${c.namespace}/${c.name}`} value={c.address}>
                      {c.namespace}/{c.name}
                    </option>
                  ))}
                </datalist>
              )}
            </label>
            <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              Threshold
              <TextField
                style={{ maxWidth: 100 }}
                type="number"
                min={0}
                value={promThreshold}
                onChange={(e) => setPromThreshold(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
            PromQL query
            <TextField
              style={{ minWidth: 320 }}
              placeholder="sum(rate(http_requests_total[2m]))"
              value={promQuery}
              onChange={(e) => setPromQuery(e.target.value)}
              spellCheck={false}
            />
          </label>
        </div>
      )}

      {errors.length > 0 && (
        <div className="error-banner" role="alert">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errors.map((e, i) => (
              <li key={i} className="small">{e}</li>
            ))}
          </ul>
        </div>
      )}

      {minReplicaCount === 0 && (
        <div className="inline-banner" role="alert">
          <div className="small">
            ⚠ scale-to-zero (minReplicaCount: 0) — the workload can go idle between triggers. Type{" "}
            <span className="mono strong">{targetName}</span> to confirm before applying.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <Badge tone="err">type name to confirm</Badge>
            <TextField
              style={{ maxWidth: 180 }}
              placeholder={targetName}
              value={zeroConfirm}
              onChange={(e) => setZeroConfirm(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
      )}

      <div style={{ height: 220 }}>
        <DiffEditor
          original=""
          modified={yaml}
          language="yaml"
          theme={monacoTheme}
          options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false }, fontSize: 12, automaticLayout: true }}
        />
      </div>

      {rejection && <PolicyRejectionCard rejection={rejection} />}
      {!rejection && msg && (
        <div className={msg.ok ? "info-banner" : "error-banner"}>{msg.text}</div>
      )}

      <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
        <Button variant="ghost" disabled={busy || blocked} onClick={() => void apply(true)}>
          Dry-run
        </Button>
        <Button disabled={busy || blocked || needsZeroConfirm} onClick={() => void apply(false)}>
          Apply
        </Button>
      </div>
    </div>
  );
}
