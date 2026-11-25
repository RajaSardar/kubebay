import { Button, Drawer } from "@kubebay/ui";
import { PageHelp } from "../../components/PageHelp";
import { SettingsBody } from "./SettingsBody";

/** The Clusters page's settings: the shared body in a side drawer. It leaves out "This cluster", since none is open. */
export default function SettingsDrawer({ onClose, onManageKubeconfigs }: { onClose: () => void; onManageKubeconfigs: () => void }) {
  return (
    <Drawer
      title="Settings"
      subtitle="Shared by all your clusters"
      subtitleMono={false}
      onClose={onClose}
      actions={
        <>
          <PageHelp route="/settings" />
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </>
      }
    >
      <div style={{ padding: 16, overflowY: "auto" }}>
        <SettingsBody onManageKubeconfigs={onManageKubeconfigs} />
      </div>
    </Drawer>
  );
}
