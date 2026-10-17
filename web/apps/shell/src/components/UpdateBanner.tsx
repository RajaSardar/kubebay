import { useState } from "react";
import { Button, InlineBanner } from "@kubebay/ui";
import { updatesApi, useUpdateStatus } from "../lib/updates";

/**
 * KB-04: a non-modal banner once the desktop app has downloaded an update.
 * It installs and restarts only when asked, and the app refuses while a
 * terminal, port-forward or change is in flight, which the banner then says.
 */
export function UpdateBanner() {
  const status = useUpdateStatus().data;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!status || (status.state !== "ready" && status.state !== "homebrew") || dismissed === status.version) return null;
  const later = (
    <Button variant="ghost" onClick={() => setDismissed(status.version)}>
      Later
    </Button>
  );

  if (status.state === "homebrew") {
    return (
      <InlineBanner tone="ok" actions={later}>
        Kubebay {status.version} is out. Homebrew installed this copy: update it with <code className="mono">brew upgrade --cask kubebay</code>
      </InlineBanner>
    );
  }

  const restart = async () => {
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
  return (
    <InlineBanner
      tone={error ? "warn" : "ok"}
      actions={
        <>
          <Button disabled={busy} onClick={() => void restart()}>
            {busy ? "Restarting…" : "Restart to update"}
          </Button>
          {later}
        </>
      }
    >
      {error ?? `Kubebay ${status.version} is ready to install.`}
    </InlineBanner>
  );
}
