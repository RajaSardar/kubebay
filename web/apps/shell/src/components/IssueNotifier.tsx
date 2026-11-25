import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { desktopNotify } from "../lib/desktopNotify";
import { claimNotification, clickTarget, createIssueNotifier } from "../lib/issueNotifications";
import { useIssues } from "../lib/useIssues";
import { useNotifySettings } from "../lib/useNotifySettings";

function Watcher({ cluster }: { cluster: string }) {
  const navigate = useNavigate();
  const [settings] = useNotifySettings();
  const { issues, loading } = useIssues(cluster);
  const notifier = useMemo(() => createIssueNotifier(Date.now), []);
  const last = useRef<{ at: number; issueId?: string } | null>(null);

  useEffect(() => {
    for (const n of notifier.observe({ cluster, issues, loading, focused: document.hasFocus(), settings })) {
      if (!claimNotification(n, Date.now())) continue; // another window already showed it
      last.current = { at: Date.now(), issueId: n.issueId };
      void desktopNotify.send(n);
    }
  }, [notifier, cluster, issues, loading, settings]);

  // A desktop OS gives the page no notification click, but clicking one brings
  // the window forward: a focus soon after a notification opens its issue.
  useEffect(() => {
    const onFocus = () => {
      const to = clickTarget(last.current, Date.now());
      last.current = null;
      if (to) navigate(to);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [navigate]);
  return null;
}

/**
 * Backlog 85: OS notifications for new Issues in the open cluster. Mounted
 * always, but does nothing (and opens no streams) in a browser tab or while the
 * Settings switch is off. Reads only what the Issues page already reads.
 */
export function IssueNotifier({ cluster }: { cluster: string | undefined }) {
  const [settings] = useNotifySettings();
  if (!desktopNotify.available() || !settings.enabled || !cluster) return null;
  return <Watcher cluster={cluster} />;
}
