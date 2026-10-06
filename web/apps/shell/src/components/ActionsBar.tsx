import { useState } from "react";
import { ArmedButton, Badge, Button, InlineBanner, Row } from "@kubebay/ui";
import { actionApi, api } from "../lib/api";
import { ownerLabel, ownerWarning, type GitOpsOwner } from "../lib/gitops";
import { PolicyRejectionError, type PolicyRejectionDetail } from "../lib/policyRejection";
import { PolicyRejectionCard } from "./PolicyRejectionCard";

type Slug = "deployments" | "statefulsets" | "daemonsets" | "cronjobs" | "nodes";

const GVR: Partial<Record<Slug, string>> = {
  deployments: "apps/v1/deployments",
  statefulsets: "apps/v1/statefulsets",
  daemonsets: "apps/v1/daemonsets",
};

function useFeedback() {
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [rejection, setRejection] = useState<PolicyRejectionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setErr("");
    setMsg("");
    setRejection(null);
    try {
      const ok = await fn();
      if (typeof ok === "string") setMsg(ok);
    } catch (e) {
      if (e instanceof PolicyRejectionError) {
        setRejection(e.rejection);
      } else {
        setErr(String(e instanceof Error ? e.message : e));
      }
    } finally {
      setBusy(false);
    }
  }
  return { msg, err, rejection, busy, run, setMsg };
}

export function ActionsBar({
  slug,
  cluster,
  ns,
  name,
  gitopsOwner,
  currentReplicas,
}: {
  slug: Slug;
  cluster: string;
  ns: string;
  name: string;
  gitopsOwner?: GitOpsOwner | null;
  currentReplicas?: number;
}) {
  const { msg, err, rejection, busy, run } = useFeedback();
  const [replicas, setReplicas] = useState(currentReplicas ?? 0);
  const ownerDetail = gitopsOwner ? ownerLabel(gitopsOwner) : undefined;

  const showScale = slug === "deployments" || slug === "statefulsets";
  const showRestart = slug === "deployments" || slug === "statefulsets" || slug === "daemonsets";

  return (
    <div className="log-controls actionsbar" style={{ flexDirection: "column", alignItems: "stretch" }}>
      {gitopsOwner && (
        <InlineBanner role="alert">
          {ownerWarning(gitopsOwner)}
        </InlineBanner>
      )}
      <Row align="center" gap={2} wrap>
      {showScale && (
        <>
          <Button
            type="button"
            variant="ghost"
            aria-label="Decrease replicas"
            disabled={busy || replicas <= 0}
            onClick={() => setReplicas((r) => Math.max(0, r - 1))}
          >
            −
          </Button>
          <span style={{ minWidth: 28, textAlign: "center" }} className="mono">{replicas}</span>
          <Button
            type="button"
            variant="ghost"
            aria-label="Increase replicas"
            disabled={busy}
            onClick={() => setReplicas((r) => r + 1)}
          >
            +
          </Button>
          <Button
            variant="ghost"
            disabled={busy || replicas === (currentReplicas ?? -1)}
            onClick={() =>
              void run(async () => {
                await api.scale({ cluster, gvr: GVR[slug]!, ns, name, replicas, gitopsOwner: ownerDetail });
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
              await api.restart({ cluster, gvr: GVR[slug]!, ns, name, gitopsOwner: ownerDetail });
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
        <ArmedButton
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
        <ArmedButton
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
          <ArmedButton
            label="Cordon"
            confirmLabel="Confirm cordon?"
            variant="primary"
            busy={busy}
            onGo={() =>
              void run(async () => {
                await actionApi.cordon({ cluster, node: name, cordon: true, gitopsOwner: ownerDetail });
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
          <ArmedButton
            label="Drain"
            confirmLabel="Drain all pods?"
            busy={busy}
            onGo={() =>
              void run(async () => {
                const r = await actionApi.drain({ cluster, node: name, gitopsOwner: ownerDetail });
                return `Drained: ${r.evicted.length} evicted, ${r.skipped.length} skipped.`;
              })
            }
          />
        </>
      )}
      {rejection && <PolicyRejectionCard rejection={rejection} />}
      {!rejection && (msg || err) && (
        <span className={`small ${err ? "error-text" : ""}`} style={{ color: err ? undefined : "var(--kb-status-ok)" }}>
          {err || msg}
        </span>
      )}
      {!msg && !err && !rejection && !busy && <Badge>actions</Badge>}
      </Row>
    </div>
  );
}
