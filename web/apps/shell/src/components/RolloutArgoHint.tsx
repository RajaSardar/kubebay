import { InlineBanner } from "@kubebay/ui";
import { updatesApi } from "../lib/updates";
import { CopyableCommand } from "./CopyableCommand";

/** The one command shown. A constant: no Rollout name or namespace is ever put into it. */
export const ARGO_DASHBOARD_COMMAND = "kubectl argo rollouts dashboard";

/**
 * Desktop app only: the command for people who also want Argo's own
 * dashboard. It spawns nothing and does not check whether the kubectl plugin
 * is installed; it only shows the text to copy.
 */
export function RolloutArgoHint() {
  if (!updatesApi.available()) return null;
  return (
    <InlineBanner flush>
      <span className="small">
        Kubebay does not embed Argo's dashboard and does not check whether the plugin is installed. To open it yourself, run this in a terminal:
      </span>
      <CopyableCommand command={ARGO_DASHBOARD_COMMAND} label="Argo Rollouts dashboard command" />
    </InlineBanner>
  );
}
