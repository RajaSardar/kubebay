import { useEffect, useState } from "react";
import { NOTIFY_SETTINGS_EVENT, loadNotifySettings, saveNotifySettings, type NotifySettings } from "./issueNotifications";

/** The notification settings, kept in step across the Settings card and the notifier. */
export function useNotifySettings(): [NotifySettings, (s: NotifySettings) => void] {
  const [s, setS] = useState(loadNotifySettings);
  useEffect(() => {
    const on = () => setS(loadNotifySettings());
    window.addEventListener(NOTIFY_SETTINGS_EVENT, on);
    return () => window.removeEventListener(NOTIFY_SETTINGS_EVENT, on);
  }, []);
  return [s, saveNotifySettings];
}
