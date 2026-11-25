import { useMemo, useRef, useState } from "react";
import { ArmedButton, Badge, Button, InlineBanner, Row } from "@kubebay/ui";
import { actionApi, api } from "../lib/api";
import { ownerLabel, ownerWarning, type GitOpsOwner } from "../lib/gitops";
import { PolicyRejectionError, type PolicyRejectionDetail } from "../lib/policyRejection";
import { availableRolloutActions, rolloutActionRequests, type RolloutAction } from "../lib/rollouts";
import { RESTART_CONFIRM_LABEL } from "../lib/restartConfirm";
import { sidecarSlug } from "../lib/addSidecar";
import { AddSidecarDialog } from "./AddSidecarDialog";
import { BlastRadiusPreview } from "./BlastRadiusPreview";
import { ReplicaControl } from "./ReplicaControl";
import { PolicyRejectionCard } from "./PolicyRejectionCard";

type Slug = "deployments" | "statefulsets" | "daemonsets" | "cronjobs" | "nodes" | "rollouts";

const GVR: Partial<Record<Slug, string>> = {
  deployments: "apps/v1/deployments",
  statefulsets: "apps/v1/statefulsets",
  daemonsets: "apps/v1/daemonsets",
  rollouts: "argoproj.io/v1alpha1/rollouts",
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
  rollout,
  obj,
  gvr,
}: {
  slug: Slug;
  /** A Rollout's own resource path (its CRD's version), when the caller knows it; else v1alpha1. */
  gvr?: string;
  cluster: string;
  ns: string;
  name: string;
  gitopsOwner?: GitOpsOwner | null;
  currentReplicas?: number;
  /** The live Rollout (slug "rollouts"): which of Pause, Resume and Skip step apply depends on its state. */
  rollout?: Record<string, unknown>;
  /** The live object: Add sidecar reads its pod template (existing containers and volumes). */
  obj?: Record<string, unknown>;
}) {
  const { msg, err, rejection, busy, run, setMsg } = useFeedback();
  const [addingSidecar, setAddingSidecar] = useState(false);
  // null = untouched → follow the live spec.replicas (the object may load after mount)
  const [edited, setEdited] = useState<number | null>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const replicas = edited ?? currentReplicas ?? 0;
  const ownerDetail = gitopsOwner ? ownerLabel(gitopsOwner) : undefined;
  // What a scale down is measured against: the live count the stepper started from.
  const scaleTarget = useMemo(() => ({ metadata: { name, namespace: ns }, spec: { replicas: currentReplicas } }), [name, ns, currentReplicas]);

  const showScale = slug === "deployments" || slug === "statefulsets" || slug === "rollouts";
  // The same Rollout actions as the Rollouts page, the ones that fit its state (Restart has its own button).
  const rolloutGvr = gvr ?? GVR.rollouts!;
  const drawerRolloutActions: RolloutAction[] =
    slug === "rollouts" && rollout ? availableRolloutActions(rollout).filter((a) => a !== "restart") : [];
  const runRolloutAction = (action: RolloutAction, done: string) =>
    void run(async () => {
      for (const req of rolloutActionRequests({ cluster, gvr: rolloutGvr, ns, name }, action, rollout ?? {})) await api.applyYaml(req);
      return done;
    });
  const showRestart = slug === "deployments" || slug === "statefulsets" || slug === "daemonsets" || slug === "rollouts";

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
          <ReplicaControl value={replicas} current={currentReplicas} onChange={setEdited} disabled={busy} statefulSet={slug === "statefulsets"} onEnter={() => applyRef.current?.focus()} />
          <Button
            ref={applyRef}
            variant={replicas !== (currentReplicas ?? -1) ? "primary" : "ghost"}
            disabled={busy || replicas === (currentReplicas ?? -1)}
            onClick={() =>
              void run(async () => {
                await api.scale({ cluster, gvr: slug === "rollouts" ? rolloutGvr : GVR[slug]!, ns, name, replicas, gitopsOwner: ownerDetail });
                return `Scaled to ${replicas}.`;
              })
            }
          >
            Apply scale
          </Button>
        </>
      )}
      {showRestart && (
        <ArmedButton
          label="Restart"
          confirmLabel={RESTART_CONFIRM_LABEL}
          busy={busy}
          onGo={() =>
            void run(async () => {
              // An Argo Rollout restarts through spec.restartAt, which its controller honours;
              // the pod-template annotation the other kinds use would not be the Rollout's own restart.
              if (slug === "rollouts") for (const req of rolloutActionRequests({ cluster, gvr: rolloutGvr, ns, name }, "restart", {})) await api.applyYaml(req);
              else await api.restart({ cluster, gvr: GVR[slug]!, ns, name, gitopsOwner: ownerDetail });
              return "Rollout restart triggered.";
            })
          }
        />
      )}
      {sidecarSlug(slug) && obj && (
        <Button variant="ghost" disabled={busy} onClick={() => setAddingSidecar(true)}>
          Add sidecar
        </Button>
      )}
      {drawerRolloutActions.includes("promote") && (
        <Button variant="ghost" disabled={busy} onClick={() => runRolloutAction("promote", "Rollout promoted.")}>
          Promote
        </Button>
      )}
      {drawerRolloutActions.includes("promote-full") && (
        <ArmedButton
          label="Promote fully"
          confirmLabel="Confirm promote fully?"
          variant="primary"
          busy={busy}
          onGo={() => runRolloutAction("promote-full", "Rollout promoted fully.")}
        />
      )}
      {drawerRolloutActions.includes("pause") && (
        <Button variant="ghost" disabled={busy} onClick={() => runRolloutAction("pause", "Rollout paused.")}>
          Pause
        </Button>
      )}
      {drawerRolloutActions.includes("resume") && (
        <Button variant="ghost" disabled={busy} onClick={() => runRolloutAction("resume", "Rollout resumed.")}>
          Resume
        </Button>
      )}
      {drawerRolloutActions.includes("skip-step") && (
        <ArmedButton
          label="Skip step"
          confirmLabel="Confirm skip?"
          variant="primary"
          busy={busy}
          onGo={() => runRolloutAction("skip-step", "Moved to the next step.")}
        />
      )}
      {drawerRolloutActions.includes("abort") && (
        <ArmedButton label="Abort" confirmLabel="Confirm abort?" busy={busy} onGo={() => runRolloutAction("abort", "Rollout aborted.")} />
      )}
      {drawerRolloutActions.includes("retry") && (
        <Button variant="ghost" disabled={busy} onClick={() => runRolloutAction("retry", "Rollout retried.")}>
          Retry
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
      {addingSidecar && sidecarSlug(slug) && obj && (
        <AddSidecarDialog
          slug={slug}
          cluster={cluster}
          obj={obj}
          onClose={() => setAddingSidecar(false)}
          onApplied={(m) => {
            setAddingSidecar(false);
            setMsg(m);
          }}
        />
      )}
      {slug === "nodes" && <BlastRadiusPreview cluster={cluster} kind="Node" obj={{ metadata: { name } }} action="drain" />}
      {(slug === "deployments" || slug === "statefulsets") && typeof currentReplicas === "number" && replicas < currentReplicas && (
        <BlastRadiusPreview
          cluster={cluster}
          kind={slug === "deployments" ? "Deployment" : "StatefulSet"}
          obj={scaleTarget}
          action={replicas === 0 ? "scale-zero" : "scale-down"}
          toReplicas={replicas}
        />
      )}
    </div>
  );
}
