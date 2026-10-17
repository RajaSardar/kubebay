import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, InlineBanner, Row, Stack } from "@kubebay/ui";
import { RELEASES_URL, UPDATE_ENDPOINT, updatesApi, useUpdateStatus, type UpdateStatus } from "../lib/updates";

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function stateLine(s: UpdateStatus): string {
  switch (s.state) {
    case "idle":
      return "Not checked yet.";
    case "checking":
      return "Checking…";
    case "up-to-date":
      return `Up to date (checked ${fmtTime(s.checkedAt)}).`;
    case "ready":
      return `Kubebay ${s.version} is downloaded and ready to install.`;
    case "homebrew":
      return `Kubebay ${s.version} is out. Homebrew installed this copy: update it with brew upgrade --cask kubebay.`;
    case "manual":
      return `This copy can't update itself (it was installed from a .deb or .rpm package). Get new versions from your package manager or ${RELEASES_URL.replace("https://", "")}.`;
    case "failed":
      return `The last check failed: ${s.error}`;
    default:
      return "";
  }
}

/**
 * KB-04: the desktop app's updater in Settings: whether it checks, the one
 * request it makes, and a "Check now". Not shown in a browser tab.
 */
export function UpdatesCard() {
  const qc = useQueryClient();
  const st = useUpdateStatus().data;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!st) return null;

  const run = async (call: () => Promise<UpdateStatus | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await call();
      if (next) qc.setQueryData(["updates"], next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="updates" style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Updates</div>
      {st.state === "unavailable" ? (
        <div className="muted small">
          This build doesn&apos;t update itself. New versions are at{" "}
          <span className="mono">{RELEASES_URL.replace("https://", "")}</span>.
        </div>
      ) : (
        <Stack gap={3}>
          <label className="small">
            <Row gap={2} align="center">
              <input
                type="checkbox"
                checked={st.autoCheck}
                disabled={busy}
                onChange={(e) => void run(() => updatesApi.setChecks(e.target.checked))}
              />
              <span>Check for updates automatically</span>
            </Row>
          </label>
          <div className="muted small">
            At launch and once a day, Kubebay fetches <span className="mono">{UPDATE_ENDPOINT.replace("https://", "")}</span>. It&apos;s
            the only request Kubebay makes on its own, and it sends nothing about you or your clusters. An update is
            checked against Kubebay&apos;s signing key before it&apos;s installed, and it installs only when you restart.
          </div>
          <Row gap={2} align="center">
            <span className="small">
              You&apos;re on {st.currentVersion}. {stateLine(st)}
            </span>
          </Row>
          <Row gap={2}>
            <Button variant="ghost" disabled={busy || st.state === "checking"} onClick={() => void run(updatesApi.checkNow)}>
              Check now
            </Button>
            {st.state === "ready" && (
              <Button disabled={busy} onClick={() => void run(updatesApi.install)}>
                Restart to update
              </Button>
            )}
          </Row>
          {error && (
            <InlineBanner tone="warn" flush>
              {error}
            </InlineBanner>
          )}
        </Stack>
      )}
    </Card>
  );
}
