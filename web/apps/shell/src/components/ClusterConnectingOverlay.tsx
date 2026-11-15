import { useEffect, useState } from "react";
import { Spinner } from "@kubebay/ui";
import { avatarLabelColor } from "./ClusterIconPicker";

// Shown over the page while switching clusters (Credentials → API Server → Live
// Stream) and while a dropped live stream reconnects.
export interface OverlayProps {
  clusterId: string;
  clusterStatus: string;
  clusterError?: string;
  clusterVersion?: string;
  wsConnected: boolean;
  wsRetry: number;
  wsNextRetryMs: number;
  isReconnect: boolean; // true = WS dropped, false = cluster switch
  /** true when switching to an already-connected cluster — keeps spinner
   *  visible briefly so the user sees the view is refreshing. */
  fastSwitch?: boolean;
  avatar: { bg: string; label: string; imageUrl?: string };
}

export function ClusterConnectingOverlay({
  clusterId,
  clusterStatus,
  clusterError,
  clusterVersion,
  wsConnected,
  wsRetry,
  wsNextRetryMs,
  isReconnect,
  fastSwitch = false,
  avatar,
}: OverlayProps) {
  const [countdown, setCountdown] = useState(Math.ceil(wsNextRetryMs / 1000));

  useEffect(() => {
    if (wsConnected || wsNextRetryMs <= 0) return;
    setCountdown(Math.ceil(wsNextRetryMs / 1000));
    const interval = setInterval(() => {
      setCountdown((n) => Math.max(0, n - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [wsNextRetryMs, wsConnected]);

  // Steps: 0=Auth/Credentials  1=API Server  2=Live Stream
  // For WS reconnect the steps are: 0=Disconnected  1=Reconnecting  2=Restored
  const steps = isReconnect
    ? ["Disconnected", "Reconnecting", "Restored"]
    : ["Credentials", "API Server", "Live Stream"];

  // Current step index
  let currentStep = 0;
  if (isReconnect) {
    if (wsConnected) currentStep = 2;
    else if (wsRetry > 0) currentStep = 1;
    else currentStep = 0;
  } else {
    if (clusterStatus === "reachable" && wsConnected) currentStep = 2;
    else if (clusterStatus === "reachable") currentStep = 1;
    else currentStep = 0;
  }

  // Status message shown under the steps
  let statusMsg = "";
  let isError = false;
  if (isReconnect) {
    if (wsConnected) {
      statusMsg = "Stream restored — reloading data…";
    } else if (wsRetry > 0) {
      statusMsg = `Attempt ${wsRetry} · retrying in ${countdown}s`;
    } else {
      statusMsg = "Connection lost — reconnecting…";
    }
  } else {
    if (fastSwitch && clusterStatus === "reachable" && wsConnected) {
      statusMsg = "Switching cluster…";
    } else if (clusterStatus === "reachable" && wsConnected) {
      statusMsg = clusterVersion ? `Connected · ${clusterVersion}` : "Connected";
    } else if (clusterStatus === "reachable") {
      statusMsg = "API reachable · opening live stream…";
    } else if (clusterError) {
      statusMsg = clusterError;
      isError = true;
    } else {
      statusMsg = "Checking cluster credentials…";
    }
  }

  // Still waiting: not failed, and not yet fully connected.
  // fastSwitch keeps waiting=true even when already reachable so the spinner
  // stays visible for the brief overlay duration before App.tsx dismisses it.
  const waiting = isReconnect
    ? !wsConnected
    : !isError && (fastSwitch || !(clusterStatus === "reachable" && wsConnected));

  return (
    <div className="conn-overlay">
      <div className="conn-card">
        {/* Avatar */}
        <div className="conn-avatar" style={{ background: avatar.imageUrl ? "transparent" : avatar.bg, color: avatarLabelColor(avatar.bg) }}>
          {avatar.imageUrl
            ? <img src={avatar.imageUrl} alt={avatar.label} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "inherit" }} />
            : avatar.label}
        </div>
        <div className="conn-cluster-name">{clusterId}</div>

        {waiting && (
          <Spinner
            className="conn-spinner"
            size={22}
            label={`${isReconnect ? "Reconnecting to" : "Connecting to"} ${clusterId}…`}
          />
        )}

        {/* Stepper */}
        <div className="conn-stepper">
          {steps.map((label, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <div key={label} className="conn-step-item">
                <div className={`conn-step-dot${done ? " done" : active ? " active" : ""}`}>
                  {done ? (
                    <svg viewBox="0 0 10 10" width="10" height="10" fill="none">
                      <polyline points="2,5 4.5,7.5 8,3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : active ? (
                    <span className="conn-pulse" />
                  ) : null}
                </div>
                {i < steps.length - 1 && (
                  <div className={`conn-step-line${done ? " done" : ""}`} />
                )}
                <div className={`conn-step-label${active ? " active" : done ? " done" : ""}`}>
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Status message */}
        <div className={`conn-status-msg${isError ? " error" : ""}`}>
          {isError && (
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 5v4M8 11v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          {statusMsg}
        </div>

        {/* Retry hint for WS reconnect */}
        {isReconnect && !wsConnected && wsRetry > 0 && (
          <div className="conn-retry-bar">
            <Spinner label={null} size={12} />
            <span>WebSocket reconnecting</span>
          </div>
        )}

        {/* Error detail hint */}
        {isError && (
          <div className="conn-error-hint">
            Check that the cluster API server is reachable and credentials are valid.
          </div>
        )}
      </div>
    </div>
  );
}
