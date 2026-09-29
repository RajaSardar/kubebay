import { useState } from "react";
import { Button, InlineBanner, Modal, Row, Stack, TextField } from "@kubebay/ui";
import { api } from "../lib/api";
import { ownerLabel, ownerOf, ownerWarning } from "../lib/gitops";
import { PolicyRejectionError, type PolicyRejectionDetail } from "../lib/policyRejection";
import { PolicyRejectionCard } from "./PolicyRejectionCard";

const GVR: Record<string, string> = {
  deployments: "apps/v1/deployments",
  statefulsets: "apps/v1/statefulsets",
  daemonsets: "apps/v1/daemonsets",
};

/** Which one-click row actions a resource table offers for a kind. */
export function workloadActions(slug: string): { scale: boolean; restart: boolean } {
  return { scale: slug === "deployments" || slug === "statefulsets", restart: slug in GVR };
}

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

/**
 * Scale or restart one workload from its table row, without opening the
 * drawer. Closes when the change is accepted (the row updates from the
 * stream); stays open with the reason when it is refused.
 */
export function WorkloadActionDialog({
  action,
  slug,
  cluster,
  obj,
  onClose,
}: {
  action: "scale" | "restart";
  slug: string;
  cluster: string;
  obj: Record<string, unknown>;
  onClose: () => void;
}) {
  const meta = rec(obj.metadata);
  const name = String(meta.name ?? "");
  const ns = String(meta.namespace ?? "");
  const current = rec(obj.spec).replicas;
  const currentText = typeof current === "number" ? String(current) : "";
  const owner = ownerOf(obj);
  const [replicas, setReplicas] = useState(currentText);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rejection, setRejection] = useState<PolicyRejectionDetail | null>(null);

  const gvr = GVR[slug]!;
  const gitopsOwner = owner ? ownerLabel(owner) : undefined;
  const canApply = action === "restart" || (replicas !== "" && replicas !== currentText);

  async function go() {
    if (!canApply || busy) return;
    setBusy(true);
    setErr("");
    setRejection(null);
    try {
      if (action === "scale") await api.scale({ cluster, gvr, ns, name, replicas: Number(replicas), gitopsOwner });
      else await api.restart({ cluster, gvr, ns, name, gitopsOwner });
      onClose();
    } catch (e) {
      if (e instanceof PolicyRejectionError) setRejection(e.rejection);
      else setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  const title = action === "scale" ? `Scale ${name}` : `Restart ${name}?`;
  return (
    <Modal label={title} onClose={onClose} placement="center">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <Stack gap={3}>
          <div className="workload-action-title">{title}</div>
          {owner && <InlineBanner flush>{ownerWarning(owner)}</InlineBanner>}
          {action === "scale" ? (
            <Row align="center" gap={2}>
              <TextField
                aria-label="Replicas"
                value={replicas}
                inputMode="numeric"
                autoFocus
                style={{ maxWidth: 90 }}
                onChange={(e) => setReplicas(e.target.value.replace(/\D/g, ""))}
              />
              {currentText && <span className="muted small">now {currentText}</span>}
            </Row>
          ) : (
            <span className="muted small">Its pods are replaced one by one, following its rollout strategy.</span>
          )}
          {rejection && <PolicyRejectionCard rejection={rejection} />}
          {err && <InlineBanner flush>{err}</InlineBanner>}
          <Row justify="end" gap={2}>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canApply || busy} autoFocus={action === "restart"}>
              {action === "scale" ? "Scale" : "Restart"}
            </Button>
          </Row>
        </Stack>
      </form>
    </Modal>
  );
}
