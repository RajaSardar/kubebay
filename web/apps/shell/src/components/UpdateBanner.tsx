import { useState } from "react";
import { Button, Corner, InlineBanner, Modal, Row, Stack } from "@kubebay/ui";
import { updatesApi, useUpdateStatus } from "../lib/updates";

/**
 * KB-04: a button in the corner once a newer version exists. It opens a popup
 * with what changed; nothing downloads or installs until "Update now", and the
 * app refuses while a terminal, port-forward or change is in flight, which the
 * popup then says.
 */
export function UpdateBanner() {
  const status = useUpdateStatus().data;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!status || (status.state !== "available" && status.state !== "downloading" && status.state !== "homebrew")) return null;
  const { version } = status;

  const update = async () => {
    setBusy(true);
    setError(null);
    try {
      await updatesApi.install();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const working = busy || status.state === "downloading";

  return (
    <>
      <Corner>
        <Button variant="primary" onClick={() => setOpen(true)} aria-label={`Update available: ${version}`}>
          Update available
        </Button>
      </Corner>
      {open && (
        <Modal label={`Kubebay ${version} is available`} title={`Kubebay ${version} is available`} onClose={() => setOpen(false)} placement="center">
          <Stack gap={3}>
            <span className="small muted">You're on {status.currentVersion}.</span>
            {status.state === "homebrew" ? (
              <span className="small">
                Homebrew installed this copy: update it with <code className="mono">brew upgrade --cask kubebay</code>
              </span>
            ) : (
              <>
                {status.state === "available" && status.notes && <span className="small">{status.notes}</span>}
                <span className="small muted">
                  It downloads when you press Update now, is checked against Kubebay's signing key, then Kubebay restarts.
                </span>
              </>
            )}
            {error && <InlineBanner flush tone="warn">{error}</InlineBanner>}
            <Row justify="end" gap={2}>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Not now
              </Button>
              {status.state !== "homebrew" && (
                <Button disabled={working} onClick={() => void update()}>
                  {working ? "Updating…" : "Update now"}
                </Button>
              )}
            </Row>
          </Stack>
        </Modal>
      )}
    </>
  );
}
