import { useEffect, useState } from "react";
import { Button, InlineBanner, Modal, Row, Select, Stack, StatusPill, TextField } from "@kubebay/ui";
import { api } from "../lib/api";
import { PolicyRejectionError } from "../lib/policyRejection";
import { useClusterLooksProduction } from "../lib/useClusterLooksProduction";
import {
  ARGO_APPLICATIONS_GVR,
  FLUX_ACTION_LABELS,
  argoHistory,
  argoRollbackBlocker,
  argoRollbackRequest,
  availableFluxActions,
  fluxActionRequest,
  fluxKindOf,
  fluxSuspended,
  gitopsActionImpact,
  type FluxAction,
  type GitOpsAction,
} from "../lib/gitopsActions";

type Obj = Record<string, unknown>;

const NOW_LABEL: Record<FluxAction, string> = { reconcile: "Reconcile now", suspend: "Suspend now", resume: "Resume now" };
const DONE: Record<FluxAction, string> = {
  reconcile: "Reconcile requested.",
  suspend: "Suspended. Flux will not reconcile it until you resume.",
  resume: "Resumed.",
};

function short(rev: string): string {
  return rev.slice(0, 7);
}

function GitOpsActionDialog({
  cluster,
  gvr,
  ns,
  name,
  action,
  obj,
  onClose,
  onDone,
}: {
  cluster: string;
  gvr: string;
  ns: string;
  name: string;
  action: GitOpsAction;
  obj?: Obj;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { production, context } = useClusterLooksProduction(cluster);
  const rollback = action === "argocd-rollback";
  // From a table row the caller may not hold the live object: read it with the user's own access.
  const [live, setLive] = useState<Obj | undefined>(obj);
  const [loadErr, setLoadErr] = useState("");
  useEffect(() => {
    if (live || !rollback) return;
    let on = true;
    api
      .getObject(cluster, gvr, ns, name)
      .then((o) => on && setLive(o))
      .catch((e) => on && setLoadErr(String(e instanceof Error ? e.message : e)));
    return () => {
      on = false;
    };
  }, [live, rollback, cluster, gvr, ns, name]);

  const history = rollback ? argoHistory(live) : [];
  const [picked, setPicked] = useState<number | null>(null);
  const chosen = history.find((h) => h.id === picked) ?? history[1] ?? history[0];
  const [prune, setPrune] = useState(false);
  const [typed, setTyped] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const blocker = rollback ? (live ? argoRollbackBlocker(live) : null) : null;
  const typedOk = !rollback || typed === name;
  const ready = !busy && typedOk && (!rollback || (!!live && !blocker && !!chosen));

  const title = rollback ? `Roll back ${name}?` : `${FLUX_ACTION_LABELS[action as FluxAction]} ${name}?`;
  const verb = rollback ? `Roll back to ${chosen ? short(chosen.revision) : "…"}` : NOW_LABEL[action as FluxAction];
  const confirmLabel = production && !rollback ? `${FLUX_ACTION_LABELS[action as FluxAction]} on ${context}` : production ? `${verb} on ${context}` : verb;

  async function go() {
    if (!ready) return;
    setBusy(true);
    setErr("");
    try {
      const target = { cluster, gvr, ns, name };
      const req = rollback ? argoRollbackRequest(target, live ?? {}, chosen!.id, { prune }) : fluxActionRequest(target, action as FluxAction);
      await api.applyYaml(req);
      onDone(rollback ? `Rollback to ${short(chosen!.revision)} started. Argo CD applies it; watch the Application's sync status.` : DONE[action as FluxAction]);
    } catch (e) {
      setErr(e instanceof PolicyRejectionError ? e.rejection.message : String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal label={title} title={title} onClose={onClose} placement="center">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <Stack gap={3}>
          {gitopsActionImpact(action, live ?? obj, { prune }).map((line) => (
            <span key={line} className="muted small">
              {line}
            </span>
          ))}
          {production && (
            <InlineBanner flush>
              {`${context} looks like a production cluster. The name is only a guess, so check the cluster before you go on.`}
            </InlineBanner>
          )}
          {loadErr && <InlineBanner flush>{loadErr}</InlineBanner>}
          {blocker && (
            <InlineBanner flush>
              {blocker}
              <div style={{ marginTop: 6 }}>
                <Button type="button" variant="ghost" onClick={() => setShowPolicy((v) => !v)}>
                  {showPolicy ? "Hide sync policy" : "Show sync policy"}
                </Button>
              </div>
              {showPolicy && <pre className="mono small">{JSON.stringify((live?.spec as Obj | undefined)?.syncPolicy ?? {}, null, 2)}</pre>}
            </InlineBanner>
          )}
          {rollback && live && !blocker && (
            <>
              <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                History entry
                <Select aria-label="History entry" value={String(chosen?.id ?? "")} onChange={(e) => setPicked(Number(e.target.value))}>
                  {history.map((h, i) => (
                    <option key={h.id} value={h.id}>
                      {`#${h.id} ${short(h.revision)}${h.deployedAt ? ` deployed ${h.deployedAt}` : ""}${i === 0 ? " (latest)" : ""}`}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="ctl">
                <input type="checkbox" aria-label="Prune resources the revision does not define" checked={prune} onChange={(e) => setPrune(e.target.checked)} />
                Prune resources the revision does not define
              </label>
              <label className="ctl" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                {`Type ${name} to confirm`}
                <TextField aria-label={`Type ${name} to confirm`} value={typed} spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
              </label>
            </>
          )}
          {err && <InlineBanner flush>{err}</InlineBanner>}
          <Row justify="end" gap={2}>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {!blocker && (
              <Button type="submit" variant={production || rollback || action === "suspend" ? "danger" : "primary"} disabled={!ready}>
                {confirmLabel}
              </Button>
            )}
          </Row>
        </Stack>
      </form>
    </Modal>
  );
}

/**
 * Flux Reconcile, Suspend and Resume, and Argo CD Rollback, for one object.
 * Each goes through a confirmation (and a second one on a cluster that looks
 * like production), then the YAML apply path as the user, so their own RBAC
 * decides and the engine audits it with their name and the GVR. These are
 * GitOps actions, so the "Git will revert this" warning is not shown.
 */
export function GitOpsActionsBar({ cluster, gvr, ns, name, obj, onDone }: { cluster: string; gvr: string; ns: string; name: string; obj?: Obj; onDone?: () => void }) {
  const [open, setOpen] = useState<GitOpsAction | null>(null);
  const [msg, setMsg] = useState("");
  const isApp = gvr === ARGO_APPLICATIONS_GVR;
  const flux: FluxAction[] = fluxKindOf(gvr) ? availableFluxActions(gvr, obj) : [];
  if (!isApp && !fluxKindOf(gvr)) return null;
  const suspended = !!fluxKindOf(gvr) && fluxSuspended(obj);

  return (
    <>
      <Row align="center" gap={2} wrap>
        {suspended && <StatusPill tone="warn">Suspended</StatusPill>}
        {flux.map((a) => (
          <Button key={a} variant="ghost" onClick={() => setOpen(a)}>
            {FLUX_ACTION_LABELS[a]}
          </Button>
        ))}
        {isApp && (
          <Button variant="ghost" onClick={() => setOpen("argocd-rollback")}>
            Rollback
          </Button>
        )}
        {msg && <span className="muted small">{msg}</span>}
      </Row>
      {open && (
        <GitOpsActionDialog
          cluster={cluster}
          gvr={gvr}
          ns={ns}
          name={name}
          action={open}
          obj={obj}
          onClose={() => setOpen(null)}
          onDone={(m) => {
            setOpen(null);
            setMsg(m);
            onDone?.();
          }}
        />
      )}
    </>
  );
}
