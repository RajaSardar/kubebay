import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArmedButton, Button, InlineBanner, Modal, Row, Select, Stack, TextField } from "@kubebay/ui";
import { api, settingsApi } from "../lib/api";
import { useClusterLooksProduction } from "../lib/useClusterLooksProduction";

/**
 * "Debug with ephemeral container" for the pod Terminal tab. Adds a debug
 * container to the running pod (the same call as `kubectl debug`), sharing the
 * target container's process namespace, then hands its name back so the
 * Terminal tab opens a shell in it through the usual exec path. Ephemeral
 * containers cannot be removed from a pod, so a cluster that looks like
 * production asks for a second click.
 */
export function DebugContainerModal({
  cluster,
  namespace,
  pod,
  containers,
  onCreated,
  onClose,
}: {
  cluster: string;
  namespace: string;
  pod: string;
  containers: string[];
  onCreated: (container: string) => void;
  onClose: () => void;
}) {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => settingsApi.get() });
  const fallback = settings.data?.debugImage || settings.data?.debugImageDefault || "";
  const [image, setImage] = useState("");
  const [edited, setEdited] = useState(false);
  const [target, setTarget] = useState(containers[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { production, context } = useClusterLooksProduction(cluster);

  // The configured image fills the field until the user types their own.
  useEffect(() => {
    if (!edited) setImage(fallback);
  }, [fallback, edited]);

  async function go() {
    setBusy(true);
    setErr("");
    try {
      const r = await api.debugContainer({ cluster, ns: namespace, name: pod, image: image.trim(), target });
      onCreated(r.container);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal label="Debug with ephemeral container" title="Debug with ephemeral container" onClose={onClose} placement="center">
      <Stack gap={3}>
        <span className="muted small">
          Adds a debug container to {pod} that shares the target container's processes, then opens a shell in it. It stays
          in the pod's spec until the pod is replaced, and it cannot be removed.
        </span>
        {production && (
          <InlineBanner flush>
            {context || cluster} looks like production. Adding a container to a live pod is a change to it.
          </InlineBanner>
        )}
        <label className="ctl">
          Image
          <TextField
            aria-label="Image"
            value={image}
            placeholder={fallback}
            spellCheck={false}
            onChange={(e) => {
              setEdited(true);
              setImage(e.target.value);
            }}
          />
        </label>
        <label className="ctl">
          Target container
          <Select aria-label="Target container" value={target} onChange={(e) => setTarget(e.target.value)}>
            {containers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </label>
        {err && <InlineBanner flush>{err}</InlineBanner>}
        <Row justify="end" gap={2}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {production ? (
            <ArmedButton
              label="Add debug container"
              confirmLabel="Confirm: add to a production pod"
              variant="primary"
              busy={busy || !image.trim()}
              onGo={() => void go()}
            />
          ) : (
            <Button variant="primary" disabled={busy || !image.trim()} onClick={() => void go()}>
              {busy ? "Adding…" : "Add debug container"}
            </Button>
          )}
        </Row>
      </Stack>
    </Modal>
  );
}
