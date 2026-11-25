import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, InlineBanner, Row, Select, Stack } from "@kubebay/ui";
import { api } from "../lib/api";
import { desktopNotify } from "../lib/desktopNotify";
import { ISSUE_SEVERITIES, type IssueSeverity } from "../lib/issues";
import { useNotifySettings } from "../lib/useNotifySettings";

/**
 * Backlog 85: opt-in OS notifications for new Issues. Per user, stored in this
 * app only; off by default. Not shown in a browser tab.
 */
export function NotificationsCard() {
  const [s, save] = useNotifySettings();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const [denied, setDenied] = useState(false);
  if (!desktopNotify.available()) return null;

  const ids = [...new Set([...(clusters.data ?? []).map((c) => c.id), ...s.mutedClusters])].sort();
  const turnOn = async (on: boolean) => {
    if (!on) {
      setDenied(false);
      save({ ...s, enabled: false });
      return;
    }
    const p = await desktopNotify.requestPermission();
    setDenied(p !== "granted");
    if (p === "granted") save({ ...s, enabled: true });
  };

  return (
    <Card id="notifications" style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Notifications</div>
      <Stack gap={3}>
        <label className="small">
          <Row gap={2} align="center">
            <input type="checkbox" aria-label="Notify me about new issues" checked={s.enabled} onChange={(e) => void turnOn(e.target.checked)} />
            <span>Notify me about new issues</span>
          </Row>
        </label>
        <div className="muted small">
          When on, Kubebay shows an OS notification for an issue that appears in the open cluster after you opened it.
          It says only the severity and the kind, namespace and name, never log lines or Secret data. Nothing is sent
          anywhere. It stays quiet while the Kubebay window is in front, notifies about an issue at most once every 6
          hours, and sends at most 3 a minute before folding the rest into one summary.
        </div>
        {denied && (
          <InlineBanner tone="warn" flush>
            The OS didn&apos;t allow notifications. Allow Kubebay under System Settings, Notifications, then switch this on again.
          </InlineBanner>
        )}
        <Row gap={2} align="center">
          <span className="small">Notify for</span>
          <Select
            aria-label="Lowest severity to notify"
            value={s.minSeverity}
            onChange={(e) => save({ ...s, minSeverity: e.target.value as IssueSeverity })}
          >
            {ISSUE_SEVERITIES.map((v, i) => (
              <option key={v} value={v}>
                {i === 0 ? "Critical only" : `${v.charAt(0).toUpperCase()}${v.slice(1)} and worse`}
              </option>
            ))}
          </Select>
        </Row>
        {ids.length > 0 && (
          <Stack gap={1}>
            <div className="small">Mute a cluster</div>
            {ids.map((id) => (
              <label key={id} className="small">
                <Row gap={2} align="center">
                  <input
                    type="checkbox"
                    aria-label={`Mute ${id}`}
                    checked={s.mutedClusters.includes(id)}
                    onChange={(e) =>
                      save({ ...s, mutedClusters: e.target.checked ? [...s.mutedClusters, id].sort() : s.mutedClusters.filter((c) => c !== id) })
                    }
                  />
                  <span className="mono">{id}</span>
                </Row>
              </label>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
