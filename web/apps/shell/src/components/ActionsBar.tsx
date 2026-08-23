import { useEffect, useState } from "react";
import { Badge, Button } from "@kubebay/ui";
import { actionApi, api } from "../lib/api";

type Slug = "deployments" | "statefulsets" | "daemonsets" | "cronjobs" | "nodes";

const GVR: Partial<Record<Slug, string>> = {
  deployments: "apps/v1/deployments",
  statefulsets: "apps/v1/statefulsets",
  daemonsets: "apps/v1/daemonsets",
};

function useFeedback() {
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const ok = await fn();
      if (typeof ok === "string") setMsg(ok);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }
  return { msg, err, busy, run, setMsg };
}

function Armed({
  label,
  confirmLabel,
  variant = "danger",
  busy,
  onGo,
}: {
  label: string;
  confirmLabel?: string;
  variant?: "danger" | "primary";
  busy?: boolean;
  onGo: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      variant={armed ? variant : "ghost"}
      disabled={busy}
      onClick={() => (armed ? onGo() : setArmed(true))}
    >
      {armed ? confirmLabel ?? `Confirm ${label.toLowerCase()}?` : label}
    </Button>
  );
}

export function ActionsBar({
  slug,
  cluster,
  ns,
  name,
}: {
  slug: Slug;
  cluster: string;
  ns: string;
  name: string;
}) {
  const { msg, err, busy, run } = useFeedback();
  const [replicas, setReplicas] = useState("");

  const showScale = slug === "deployments" || slug === "statefulsets";
  const showRestart = slug === "deployments" || slug === "statefulsets" || slug === "daemonsets";

  return (
    <div className="log-controls actionsbar">
      {showScale && (
        <>
          <label className="ctl">
            replicas
            <input
              className="toolbar-input"
              style={{ maxWidth: 70 }}
              placeholder="n"
              value={replicas}
              onChange={(e) => setReplicas(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
            />
          </label>
          <Button
            variant="ghost"
            disabled={busy || !replicas}
            onClick={() =>
              void run(async () => {
                await api.scale({ cluster, gvr: GVR[slug]!, ns, name, replicas: Number(replicas) });
                return `Scaled to ${replicas}.`;
              })
            }
          >
            Apply scale
          </Button>
        </>
      )}
      {showRestart && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api.restart({ cluster, gvr: GVR[slug]!, ns, name });
              return "Rollout restart triggered.";
            })
          }
        >
          Restart
        </Button>
      )}
      {slug === "cronjobs" && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await actionApi.triggerCronJob({ cluster, ns, name });
              return `Created job ${r.job} — see Jobs table.`;
            })
          }
        >
          Trigger now
        </Button>
      )}
      {slug === "cronjobs" && (
        <Armed
          label="Suspend"
          confirmLabel="Confirm suspend?"
          variant="primary"
          busy={busy}
          onGo={() =>
            void run(async () => {
              await actionApi.suspendCronJob({ cluster, ns, name, suspend: true });
              return "Suspended.";
            })
          }
        />
      )}
      {slug === "cronjobs" && (
        <Armed
          label="Resume"
          confirmLabel="Confirm resume?"
          variant="primary"
          busy={busy}
          onGo={() =>
            void run(async () => {
              await actionApi.suspendCronJob({ cluster, ns, name, suspend: false });
              return "Resumed.";
            })
          }
        />
      )}
      {slug === "nodes" && (
        <>
          <Armed
            label="Cordon"
            confirmLabel="Confirm cordon?"
            variant="primary"
            busy={busy}
            onGo={() =>
              void run(async () => {
                await actionApi.cordon({ cluster, node: name, cordon: true });
                return "Node cordoned — no new pods scheduled.";
              })
            }
          />
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await actionApi.cordon({ cluster, node: name, cordon: false });
                return "Node uncordoned.";
              })
            }
          >
            Uncordon
          </Button>
          <Armed
            label="Drain"
            confirmLabel="Drain all pods?"
            busy={busy}
            onGo={() =>
              void run(async () => {
                const r = await actionApi.drain({ cluster, node: name });
                return `Drained: ${r.evicted.length} evicted, ${r.skipped.length} skipped.`;
              })
            }
          />
        </>
      )}
      {(msg || err) && (
        <span className={`small ${err ? "error-text" : ""}`} style={{ color: err ? undefined : "var(--kb-status-ok)" }}>
          {err || msg}
        </span>
      )}
      {!msg && !err && !busy && <Badge>actions</Badge>}
    </div>
  );
}
