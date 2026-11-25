import { PageHeader } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { useCluster } from "../lib/useCluster";
import { SettingsBody } from "./settings/SettingsBody";

/** The Settings page: a header over the body that the Clusters page drawer shares. Inside a cluster it adds "This cluster". */
export default function Settings() {
  const { cluster } = useCluster();
  return (
    <div className="page" style={{ overflowY: "auto" }}>
      <PageHeader help={<PageHelp route="/settings" />} title="Settings" />
      <SettingsBody cluster={cluster || undefined} />
    </div>
  );
}
